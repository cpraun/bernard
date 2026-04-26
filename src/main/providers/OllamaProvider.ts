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
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { NAIProvider, ModelInfo } from './NAIProvider'
import type { ChatMessage, FileContext, NAIResponse, ToolDefinition } from '../../shared/types'
import type { InteractionLogger } from '../services/InteractionLogger'
import { executeToolCall, isToolError, BUILTIN_SERVER } from '../services/ToolExecutionService'
import type { ToolExecutionContext } from '../services/ToolExecutionService'
import { getBuiltinToolsDir } from '../services/ConfigService'

export type RAGQueryFn = (text: string) => Promise<{ title: string; text: string }[]>

export class OllamaProvider implements NAIProvider {
  readonly id = 'ollama'
  readonly name = 'Ollama'
  private baseUrl: string
  private model: string
  private queryRAG?: RAGQueryFn

  constructor(baseUrl = 'http://localhost:11434', model = 'llama3.2', queryRAG?: RAGQueryFn) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.model = model
    this.queryRAG = queryRAG
  }

  async testConnection(): Promise<ModelInfo> {
    const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`)

    const json = (await res.json()) as { models?: { name: string }[] }
    const models = json.models ?? []
    const modelNames = models.map((m) => m.name).join(', ')

    return {
      model: this.model,
      displayName: `Ollama (${models.length} model${models.length !== 1 ? 's' : ''}: ${modelNames || 'none'})`
    }
  }

  async sendMessage(
    messages: ChatMessage[],
    context?: FileContext[],
    toolDefinitions?: ToolDefinition[],
    signal?: AbortSignal,
    onProgress?: (data: import('./NAIProvider').ProgressData) => void,
    logger?: InteractionLogger,
    onToolApproval?: import('./NAIProvider').ToolApprovalFn
  ): Promise<NAIResponse> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiMessages: any[] = messages.map((m) => ({ role: m.role, content: m.content }))

    // RAG: query local vector store for relevant skill chunks
    let sources: { title: string; text?: string }[] | undefined
    if (this.queryRAG) {
      const lastUserMsg = apiMessages.filter((m: { role: string }) => m.role === 'user').pop()
      if (lastUserMsg) {
        try {
          const ragResults = await this.queryRAG(lastUserMsg.content)
          if (ragResults.length > 0) {
            let ragPrefix = 'Relevant knowledge from your files:\n\n'
            sources = []
            for (const r of ragResults) {
              ragPrefix += `--- ${r.title} ---\n${r.text}\n\n`
              sources.push({ title: r.title, text: r.text })
            }
            ragPrefix += '---\n\n'
            const last = apiMessages[apiMessages.length - 1]
            apiMessages[apiMessages.length - 1] = { ...last, content: ragPrefix + last.content }
          }
        } catch (err) {
          console.error('[OllamaProvider] RAG query failed:', err)
        }
      }
    }
    if (sources && sources.length > 0) {
      onProgress?.({ type: 'sources', sources })
      logger?.log('RAG_SOURCES', sources.map(s => s.title).join(', '))
    }

    // Prepend context files to the last user message
    if (context && context.length > 0) {
      logger?.log('CONTEXT_FILES', context.map(f => f.filename).join(', '))
      const textFiles = context.filter(f => !f.mediaType)
      const imageFiles = context.filter(f => f.mediaType)

      if (textFiles.length > 0) {
        let prefix = 'Context files:\n\n'
        for (const file of textFiles) {
          prefix += `--- ${file.filename} (${file.type}) ---\n${file.content}\n\n`
        }
        prefix += '---\n\n'
        const last = apiMessages[apiMessages.length - 1]
        apiMessages[apiMessages.length - 1] = { ...last, content: prefix + last.content }
      }

      // Ollama supports images via the `images` field (base64 strings)
      if (imageFiles.length > 0) {
        const last = apiMessages[apiMessages.length - 1]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(last as any).images = imageFiles.map(img => img.content)
      }
    }

    // Build Ollama-format tools array from tool definitions
    const tools = toolDefinitions && toolDefinitions.length > 0
      ? toolDefinitions.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            ...(t.description ? { description: t.description } : {}),
            ...(t.parameters ? { parameters: this.convertParameters(t.parameters) } : {})
          }
        }))
      : undefined

    if (tools) logger?.log('TOOLS_AVAILABLE', toolDefinitions!.map(t => t.name).join(', '))
    logger?.log('API_CALL', `model=${this.model}`)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = { model: this.model, messages: apiMessages, stream: false }
    if (tools) body.tools = tools

    logger?.log('API_REQUEST', JSON.stringify(body, null, 2))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
      })
      if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`)
      json = (await res.json()) as any
      logger?.log('API_RESPONSE', JSON.stringify(json, null, 2))
    } catch (err) {
      logger?.log('API_ERROR', String(err))
      throw err
    }
    // Check if the model wants to call a function
    const toolCalls = json.message?.tool_calls
    if (toolCalls && toolCalls.length > 0) {
      const tc = toolCalls[0]
      const fcName: string = tc.function.name
      const fcArgs: Record<string, unknown> = tc.function.arguments ?? {}
      let toolsUsed: { name: string; args?: Record<string, unknown>; error?: boolean }[] | undefined
      onProgress?.({ type: 'toolCall', tool: { name: fcName, args: fcArgs } })

      logger?.log('TOOL_CALL', `${fcName}(${JSON.stringify(fcArgs)})`)

      // Execute the function implementation
      let functionResult: Record<string, unknown>
      try {
        const toolDef = toolDefinitions?.find(t => t.name === fcName)
        const execContext: ToolExecutionContext = {
          runSubAgent: (prompt, subSignal, model) => this.runSubAgent(prompt, subSignal ?? signal, model)
        }
        functionResult = await executeToolCall(fcName, fcArgs, toolDef?._mcpServer, execContext) as Record<string, unknown>
        const errCheck = isToolError(functionResult)
        if (errCheck.isError) {
          console.error(`[OllamaProvider] Tool "${fcName}" returned error:`, errCheck.message)
          logger?.log('TOOL_ERROR', `${fcName} — ${errCheck.message}`)
          toolsUsed = [{ name: fcName, args: fcArgs, error: true }]
        } else {
          logger?.log('TOOL_RESULT', JSON.stringify(functionResult))
          toolsUsed = [{ name: fcName, args: fcArgs }]

          if (onToolApproval) {
            const approved = await onToolApproval(fcName, fcArgs, functionResult)
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
        if (err instanceof DOMException && err.name === 'AbortError') throw err
        console.error(`[OllamaProvider] Tool "${fcName}" execution failed:`, err)
        functionResult = { error: String(err) }
        logger?.log('TOOL_ERROR', `${fcName} — ${String(err)}`)
        toolsUsed = [{ name: fcName, args: fcArgs, error: true }]
      }

      // Send the function result back to get a final text response
      const followUpMessages = [
        ...apiMessages,
        json.message,
        { role: 'tool', content: JSON.stringify(functionResult) }
      ]

      logger?.log('API_CALL', `follow-up after tool ${fcName}, model=${this.model}`)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const followUpBody: any = { model: this.model, messages: followUpMessages, stream: false }
      if (tools) followUpBody.tools = tools

      logger?.log('API_REQUEST', JSON.stringify(followUpBody, null, 2))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let followUpJson: any
      try {
        const followUpRes = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(followUpBody),
          signal
        })
        if (!followUpRes.ok) throw new Error(`Ollama error ${followUpRes.status}: ${await followUpRes.text()}`)
        followUpJson = (await followUpRes.json()) as any
        logger?.log('API_RESPONSE', JSON.stringify(followUpJson, null, 2))
      } catch (err) {
        logger?.log('API_ERROR', String(err))
        throw err
      }
      logger?.log('RESPONSE', `${followUpJson.eval_count ?? 0} completion tokens`)
      return {
        content: followUpJson.message?.content ?? '',
        model: followUpJson.model,
        usage:
          followUpJson.prompt_eval_count != null || followUpJson.eval_count != null
            ? {
                promptTokens: followUpJson.prompt_eval_count ?? 0,
                completionTokens: followUpJson.eval_count ?? 0
              }
            : undefined,
        sources,
        toolsUsed
      }
    }

    logger?.log('RESPONSE', `${json.eval_count ?? 0} completion tokens`)
    return {
      content: json.message?.content ?? '',
      model: json.model,
      usage:
        json.prompt_eval_count != null || json.eval_count != null
          ? {
              promptTokens: json.prompt_eval_count ?? 0,
              completionTokens: json.eval_count ?? 0
            }
          : undefined,
      sources
    }
  }

  /**
   * Run a sub-agent agentic loop using the same Ollama endpoint.
   * Loads all built-in tools from disk and loops until the model stops calling tools.
   * Recursion is capped at MAX_DEPTH to prevent runaway nesting.
   */
  private async runSubAgent(
    prompt: string,
    signal?: AbortSignal,
    modelOverride?: string,
    depth = 0
  ): Promise<string> {
    const MAX_DEPTH = 3
    if (depth >= MAX_DEPTH) return `[Sub-agent depth limit (${MAX_DEPTH}) reached]`

    const model = modelOverride ?? this.model

    // Load all built-in tool schemas in Ollama format
    const builtinDir = getBuiltinToolsDir()
    const tools = readdirSync(builtinDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const def = JSON.parse(readFileSync(join(builtinDir, f), 'utf-8'))
        return {
          type: 'function' as const,
          function: {
            name: def.name as string,
            ...(def.description ? { description: def.description as string } : {}),
            ...(def.parameters ? { parameters: this.convertParameters(def.parameters) } : {})
          }
        }
      })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let messages: any[] = [{ role: 'user', content: prompt }]

    // Sub-agent agentic loop — continues until the model stops calling tools
    while (true) {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, tools, stream: false }),
        signal
      })
      if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await res.json()) as any

      const toolCalls = json.message?.tool_calls
      if (!toolCalls || toolCalls.length === 0) {
        return json.message?.content ?? ''
      }

      const tc = toolCalls[0]
      const fcName: string = tc.function.name
      const fcArgs: Record<string, unknown> = tc.function.arguments ?? {}

      const subContext: ToolExecutionContext = {
        runSubAgent: (p, s, m) => this.runSubAgent(p, s, m, depth + 1)
      }
      const toolResult = await executeToolCall(fcName, fcArgs, BUILTIN_SERVER, subContext)

      messages = [
        ...messages,
        json.message,
        { role: 'tool', content: JSON.stringify(toolResult) }
      ]
    }
  }

  /**
   * Convert Gemini-style parameter schema (uppercase types) to JSON Schema (lowercase types).
   */
  private convertParameters(params: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...params }
    if (typeof result.type === 'string') {
      result.type = result.type.toLowerCase()
    }
    if (result.properties && typeof result.properties === 'object') {
      const converted: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(result.properties as Record<string, unknown>)) {
        if (value && typeof value === 'object') {
          converted[key] = this.convertParameters(value as Record<string, unknown>)
        } else {
          converted[key] = value
        }
      }
      result.properties = converted
    }
    if (Array.isArray(result.items) && typeof result.items === 'object') {
      result.items = this.convertParameters(result.items as Record<string, unknown>)
    }
    return result
  }

}
