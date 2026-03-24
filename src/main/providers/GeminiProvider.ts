/*
 * Copyright 2026 Christoph von Praun
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { GoogleGenAI } from '@google/genai'
import type { NAIProvider, ModelInfo } from './NAIProvider'
import type { ChatMessage, FileContext, NAIResponse, ToolDefinition } from '../../shared/types'
import type { InteractionLogger } from '../services/InteractionLogger'
import type { RAGQueryFn } from './OllamaProvider'
import { executeToolCall, isToolError } from '../services/ToolExecutionService'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// JSON Schema properties not supported by Gemini's function declaration API
const UNSUPPORTED_GEMINI_KEYS = new Set(['exclusiveMaximum', 'exclusiveMinimum'])

function sanitizeParamsForGemini(obj: any): any {
  if (Array.isArray(obj)) return obj.map(sanitizeParamsForGemini)
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (UNSUPPORTED_GEMINI_KEYS.has(k)) {
        // Drop properties not supported by Gemini
      } else if (k === 'enum' && Array.isArray(v)) {
        // Gemini only allows enum on STRING type properties
        if (obj.type === 'string') {
          out[k] = v.map((item) => String(item))
        }
        // Drop enum for non-string types (integer, number, etc.)
      } else {
        out[k] = sanitizeParamsForGemini(v)
      }
    }
    return out
  }
  return obj
}

export class GeminiProvider implements NAIProvider {
  readonly id = 'gemini'
  readonly name = 'Google Gemini'
  private ai: GoogleGenAI
  private model: string
  private temperature?: number
  private topK?: number
  private maxOutputTokens?: number
  private fileSearchStoreName?: string
  private queryRAG?: RAGQueryFn

  constructor(
    apiKey: string,
    model = 'gemini-2.5-flash',
    temperature?: number,
    topK?: number,
    maxOutputTokens?: number,
    fileSearchStoreName?: string,
    queryRAG?: RAGQueryFn
  ) {
    this.ai = new GoogleGenAI({ apiKey })
    this.model = model
    this.temperature = temperature
    this.topK = topK
    this.maxOutputTokens = maxOutputTokens
    this.fileSearchStoreName = fileSearchStoreName
    this.queryRAG = queryRAG
  }

  async sendMessage(messages: ChatMessage[], context?: FileContext[], toolDefinitions?: ToolDefinition[], signal?: AbortSignal, onProgress?: (data: import('./NAIProvider').ProgressData) => void, logger?: InteractionLogger, onToolApproval?: import('./NAIProvider').ToolApprovalFn): Promise<NAIResponse> {
    // Extract system messages for Gemini's systemInstruction
    const systemMessages = messages.filter((m) => m.role === 'system')
    const systemInstruction = systemMessages.length > 0
      ? systemMessages.map((m) => m.content).join('\n\n')
      : undefined

    // Build full content array in Gemini format (exclude system messages)
    const contents = messages
      .filter((msg) => msg.role !== 'system')
      .map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }))

    // Prepend manually selected context files to the last user message
    if (context && context.length > 0) {
      const textFiles = context.filter(f => !f.mediaType)
      const imageFiles = context.filter(f => f.mediaType)
      const last = contents[contents.length - 1]

      if (imageFiles.length > 0) {
        // Multimodal: build parts array with inlineData for images
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parts: any[] = []
        if (textFiles.length > 0) {
          let prefix = 'Context files:\n\n'
          for (const file of textFiles) {
            prefix += `--- ${file.filename} (${file.type}) ---\n${file.content}\n\n`
          }
          prefix += '---\n\n'
          parts.push({ text: prefix })
        }
        for (const img of imageFiles) {
          parts.push({ inlineData: { mimeType: img.mediaType, data: img.content } })
        }
        parts.push({ text: last.parts[0].text })
        contents[contents.length - 1] = { ...last, parts }
      } else {
        let prefix = 'Context files:\n\n'
        for (const file of textFiles) {
          prefix += `--- ${file.filename} (${file.type}) ---\n${file.content}\n\n`
        }
        prefix += '---\n\n'
        contents[contents.length - 1] = { ...last, parts: [{ text: prefix + last.parts[0].text }] }
      }
    }

    // RAG: query local vector store for relevant skill chunks
    let ragSources: { title: string; text?: string }[] | undefined
    if (this.queryRAG) {
      const lastUserMsg = contents.filter((m) => m.role === 'user').pop()
      if (lastUserMsg) {
        try {
          const ragResults = await this.queryRAG(lastUserMsg.parts[0].text)
          if (ragResults.length > 0) {
            let ragPrefix = 'Relevant knowledge from your files:\n\n'
            ragSources = []
            for (const r of ragResults) {
              ragPrefix += `--- ${r.title} ---\n${r.text}\n\n`
              ragSources.push({ title: r.title, text: r.text })
            }
            ragPrefix += '---\n\n'
            const last = contents[contents.length - 1]
            contents[contents.length - 1] = { ...last, parts: [{ text: ragPrefix + last.parts[0].text }] }
          }
        } catch (err) {
          console.error('[GeminiProvider] RAG query failed:', err)
        }
      }
    }
    if (ragSources && ragSources.length > 0) {
      onProgress?.({ type: 'sources', sources: ragSources })
      logger?.log('RAG_SOURCES', ragSources.map(s => s.title).join(', '))
    }
    if (context && context.length > 0) {
      logger?.log('CONTEXT_FILES', context.map(f => f.filename).join(', '))
    }

    // Build tools array
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any[] = []
    const hasFunctionCalls = toolDefinitions && toolDefinitions.length > 0
    if (hasFunctionCalls) {
      tools.push({
        functionDeclarations: toolDefinitions.map((t) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const decl: any = { name: t.name }
          if (t.description) decl.description = t.description
          if (t.parameters && Object.keys(t.parameters).length > 0) decl.parameters = sanitizeParamsForGemini(t.parameters)
          return decl
        })
      })
    }
    if (this.fileSearchStoreName) {
      tools.push({ fileSearch: { fileSearchStoreNames: [this.fileSearchStoreName] } })
    }

    let prePromptTokens: number | undefined
    try {
      const ct = await this.ai.models.countTokens({ model: this.model, contents })
      prePromptTokens = ct.totalTokens ?? undefined
    } catch {
      // non-fatal — fall back to usageMetadata value after response
    }

    const toolsConfig = tools.length > 0 ? tools : undefined
    if (hasFunctionCalls) logger?.log('TOOLS_AVAILABLE', toolDefinitions!.map(t => t.name).join(', '))
    logger?.log('API_CALL', `model=${this.model}`)

    const generateParams = {
      model: this.model,
      contents,
      config: {
        systemInstruction,
        temperature: this.temperature,
        topK: this.topK,
        maxOutputTokens: this.maxOutputTokens,
        tools: toolsConfig
      }
    }
    logger?.log('API_REQUEST', JSON.stringify(generateParams, null, 2))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let response: any
    try {
      const responsePromise = this.ai.models.generateContent(generateParams)

      response = signal
        ? await Promise.race([
            responsePromise,
            new Promise<never>((_, reject) => {
              if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'))
              else signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
            })
          ])
        : await responsePromise

      logger?.log('API_RESPONSE', JSON.stringify(response, null, 2))
    } catch (err) {
      logger?.log('API_ERROR', String(err))
      throw err
    }

    // Check if the response contains a function call
    const parts = response.candidates?.[0]?.content?.parts ?? []
    const functionCallPart = parts.find((p: { functionCall?: unknown }) => p.functionCall)

    let finalResponse = response
    let toolsUsed: { name: string; args?: Record<string, unknown>; error?: boolean }[] | undefined
    if (functionCallPart?.functionCall) {
      const fcName: string = functionCallPart.functionCall.name ?? ''
      const fcArgs: Record<string, unknown> = functionCallPart.functionCall.args ?? {}
      onProgress?.({ type: 'toolCall', tool: { name: fcName, args: fcArgs } })
      logger?.log('TOOL_CALL', `${fcName}(${JSON.stringify(fcArgs)})`)

      // Execute the function implementation
      let functionResult: Record<string, unknown> | undefined
      try {
        const toolDef = toolDefinitions?.find(t => t.name === fcName)
        functionResult = await executeToolCall(fcName, fcArgs, toolDef?._mcpServer) as Record<string, unknown>
        const errCheck = isToolError(functionResult)
        if (errCheck.isError) {
          console.error(`[GeminiProvider] Tool "${fcName}" returned error:`, errCheck.message)
          logger?.log('TOOL_ERROR', `${fcName} — ${errCheck.message}`)
          toolsUsed = [{ name: fcName, args: fcArgs, error: true }]
        } else {
          logger?.log('TOOL_RESULT', JSON.stringify(functionResult))
          toolsUsed = [{ name: fcName, args: fcArgs }]

          if (onToolApproval) {
            const approved = await onToolApproval(fcName, fcArgs, functionResult!)
            if (!approved) {
              logger?.log('TOOL_DECLINED', `User declined to send result of "${fcName}" to AI`)
              return {
                content: `Tool call "${fcName}" was executed successfully, but the user declined to send the result to the AI provider.`,
                model: this.model,
                isError: true,
                toolsUsed
              }
            }
          }
        }
      } catch (err) {
        console.error(`[GeminiProvider] Tool "${fcName}" execution failed:`, err)
        functionResult = { error: String(err) } as Record<string, unknown>
        logger?.log('TOOL_ERROR', `${fcName} — ${String(err)}`)
        toolsUsed = [{ name: fcName, args: fcArgs, error: true }]
      }

      // Send the function result back to Gemini to get a final text response.
      // Preserve the original model parts (including thought_signature) to satisfy
      // Gemini's requirement for thought signatures in function call round-trips.
      const modelParts = response.candidates?.[0]?.content?.parts ?? [{ functionCall: { name: fcName, args: fcArgs } }]
      const followUpContents = [
        ...contents,
        { role: 'model' as const, parts: modelParts },
        { role: 'user' as const, parts: [{ functionResponse: { name: fcName, response: functionResult } }] }
      ]

      logger?.log('API_CALL', `follow-up after tool ${fcName}, model=${this.model}`)

      const followUpGenerateParams = {
        model: this.model,
        contents: followUpContents,
        config: {
          systemInstruction,
          temperature: this.temperature,
          topK: this.topK,
          maxOutputTokens: this.maxOutputTokens,
          tools: tools.length > 0 ? tools : undefined
        }
      }
      logger?.log('API_REQUEST', JSON.stringify(followUpGenerateParams, null, 2))

      try {
        const followUpPromise = this.ai.models.generateContent(followUpGenerateParams)

        finalResponse = signal
          ? await Promise.race([
              followUpPromise,
              new Promise<never>((_, reject) => {
                if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'))
                else signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
              })
            ])
          : await followUpPromise

        logger?.log('API_RESPONSE', JSON.stringify(finalResponse, null, 2))
      } catch (err) {
        logger?.log('API_ERROR', String(err))
        throw err
      }
    }

    const chunks = finalResponse.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
    const seen = new Set<string>()
    const sources: { title: string; text?: string }[] = []
    for (const chunk of chunks) {
      const ctx = chunk.retrievedContext
      if (ctx?.title && !seen.has(ctx.title)) {
        seen.add(ctx.title)
        sources.push({ title: ctx.title, text: ctx.text ?? undefined })
      }
    }
    const allSources = [...(ragSources ?? []), ...sources]

    // Extract text from parts manually to avoid SDK warning about non-text parts
    const finalParts = finalResponse.candidates?.[0]?.content?.parts ?? []
    const textContent = finalParts
      .filter((p: { text?: string }) => typeof p.text === 'string')
      .map((p: { text?: string }) => p.text)
      .join('')

    const completionTokens = finalResponse.usageMetadata?.candidatesTokenCount ?? 0
    logger?.log('RESPONSE', `${completionTokens} completion tokens`)
    return {
      content: textContent || '',
      model: this.model,
      usage: finalResponse.usageMetadata
        ? {
            promptTokens: prePromptTokens ?? finalResponse.usageMetadata.promptTokenCount ?? 0,
            completionTokens: finalResponse.usageMetadata.candidatesTokenCount ?? 0
          }
        : prePromptTokens !== undefined
          ? { promptTokens: prePromptTokens, completionTokens: 0 }
          : undefined,
      sources: allSources.length > 0 ? allSources : undefined,
      toolsUsed
    }
  }

  async testConnection(): Promise<ModelInfo> {
    const info = await this.ai.models.get({ model: this.model })
    return {
      model: this.model,
      displayName: info.displayName,
      inputTokenLimit: info.inputTokenLimit,
      outputTokenLimit: info.outputTokenLimit
    }
  }
}
