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
import Anthropic from '@anthropic-ai/sdk'
import type { NAIProvider, ModelInfo } from './NAIProvider'
import type { ChatMessage, FileContext, NAIResponse, ToolDefinition } from '../../shared/types'
import type { InteractionLogger } from '../services/InteractionLogger'
import type { RAGQueryFn } from './OllamaProvider'
import { executeToolCall, isToolError } from '../services/ToolExecutionService'

export class AnthropicProvider implements NAIProvider {
  readonly id = 'anthropic'
  readonly name = 'Anthropic (Claude)'
  private client: Anthropic
  private model: string
  private temperature?: number
  private maxOutputTokens: number
  private queryRAG?: RAGQueryFn

  constructor(
    apiKey: string,
    model = 'claude-sonnet-4-20250514',
    temperature?: number,
    maxOutputTokens = 8192,
    queryRAG?: RAGQueryFn
  ) {
    this.client = new Anthropic({ apiKey })
    this.model = model
    this.temperature = temperature
    this.maxOutputTokens = maxOutputTokens
    this.queryRAG = queryRAG
  }

  async testConnection(): Promise<ModelInfo> {
    // Send a minimal message to verify connectivity and get model info
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Hi' }]
    })
    return {
      model: response.model,
      displayName: `Anthropic (${response.model})`
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
    // Extract system messages for Anthropic's system parameter
    const systemMessages = messages.filter((m) => m.role === 'system')
    const system = systemMessages.length > 0
      ? systemMessages.map((m) => m.content).join('\n\n')
      : undefined

    // Build messages array (exclude system messages)
    const apiMessages: Anthropic.MessageParam[] = messages
      .filter((msg) => msg.role !== 'system')
      .map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      }))

    // RAG: query local vector store for relevant skill chunks
    let sources: { title: string; text?: string }[] | undefined
    if (this.queryRAG) {
      const lastUserMsg = apiMessages.filter((m) => m.role === 'user').pop()
      if (lastUserMsg && typeof lastUserMsg.content === 'string') {
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
            apiMessages[apiMessages.length - 1] = {
              ...last,
              content: ragPrefix + (last.content as string)
            }
          }
        } catch (err) {
          console.error('[AnthropicProvider] RAG query failed:', err)
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
      const last = apiMessages[apiMessages.length - 1]

      if (imageFiles.length > 0) {
        // Multimodal: build content blocks array
        const contentBlocks: Anthropic.ContentBlockParam[] = []
        if (textFiles.length > 0) {
          let prefix = 'Context files:\n\n'
          for (const file of textFiles) {
            prefix += `--- ${file.filename} (${file.type}) ---\n${file.content}\n\n`
          }
          prefix += '---\n\n'
          contentBlocks.push({ type: 'text', text: prefix })
        }
        for (const img of imageFiles) {
          contentBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: img.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: img.content }
          })
        }
        contentBlocks.push({ type: 'text', text: last.content as string })
        apiMessages[apiMessages.length - 1] = { ...last, content: contentBlocks as unknown as string }
      } else {
        // Text-only context: prepend as before
        let prefix = 'Context files:\n\n'
        for (const file of textFiles) {
          prefix += `--- ${file.filename} (${file.type}) ---\n${file.content}\n\n`
        }
        prefix += '---\n\n'
        apiMessages[apiMessages.length - 1] = { ...last, content: prefix + (last.content as string) }
      }
    }

    // Build Anthropic-format tools array from tool definitions
    const tools: Anthropic.Tool[] | undefined =
      toolDefinitions && toolDefinitions.length > 0
        ? toolDefinitions.map((t) => ({
            name: t.name,
            description: t.description ?? '',
            input_schema: this.convertParameters(t.parameters ?? { type: 'object', properties: {} }) as Anthropic.Tool['input_schema']
          }))
        : undefined

    if (tools) logger?.log('TOOLS_AVAILABLE', tools.map(t => t.name).join(', '))

    logger?.log('API_CALL', `model=${this.model}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any = {
      model: this.model,
      max_tokens: this.maxOutputTokens,
      messages: apiMessages
    }
    if (system) params.system = system
    if (this.temperature !== undefined) params.temperature = this.temperature
    if (tools) params.tools = tools

    logger?.log('API_REQUEST', JSON.stringify(params, null, 2))

    let response: Awaited<ReturnType<typeof this.client.messages.create>>
    try {
      const responsePromise = this.client.messages.create(params)

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
    // Check if the model wants to call a tool
    if (response.stop_reason === 'tool_use') {
      const toolUseBlock = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      )

      if (toolUseBlock) {
        const fcName = toolUseBlock.name
        const fcArgs = (toolUseBlock.input ?? {}) as Record<string, unknown>
        let toolsUsed: { name: string; args?: Record<string, unknown>; error?: boolean }[] | undefined
        onProgress?.({ type: 'toolCall', tool: { name: fcName, args: fcArgs } })

        logger?.log('TOOL_CALL', `${fcName}(${JSON.stringify(fcArgs)})`)

        // Execute the function implementation
        let functionResult: Record<string, unknown>
        try {
          const toolDef = toolDefinitions?.find(t => t.name === fcName)
          functionResult = await executeToolCall(fcName, fcArgs, toolDef?._mcpServer) as Record<string, unknown>
          const errCheck = isToolError(functionResult)
          if (errCheck.isError) {
            console.error(`[AnthropicProvider] Tool "${fcName}" returned error:`, errCheck.message)
            logger?.log('TOOL_ERROR', `${fcName} — ${errCheck.message}`)
            toolsUsed = [{ name: fcName, args: fcArgs, error: true }]
          } else {
            logger?.log('TOOL_RESULT', JSON.stringify(functionResult))
            toolsUsed = [{ name: fcName, args: fcArgs }]

            // Ask user for approval before sending result to AI
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
          console.error(`[AnthropicProvider] Tool "${fcName}" execution failed:`, err)
          functionResult = { error: String(err) }
          logger?.log('TOOL_ERROR', `${fcName} — ${String(err)}`)
          toolsUsed = [{ name: fcName, args: fcArgs, error: true }]
        }

        // Send the tool result back to get a final text response
        const followUpMessages: Anthropic.MessageParam[] = [
          ...apiMessages,
          { role: 'assistant', content: response.content },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUseBlock.id,
                content: JSON.stringify(functionResult)
              }
            ]
          }
        ]

        logger?.log('API_CALL', `follow-up after tool ${fcName}, model=${this.model}`)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const followUpParams: any = {
          model: this.model,
          max_tokens: this.maxOutputTokens,
          messages: followUpMessages
        }
        if (system) followUpParams.system = system
        if (this.temperature !== undefined) followUpParams.temperature = this.temperature
        if (tools) followUpParams.tools = tools

        logger?.log('API_REQUEST', JSON.stringify(followUpParams, null, 2))

        let followUpResponse: Awaited<ReturnType<typeof this.client.messages.create>>
        try {
          const followUpPromise = this.client.messages.create(followUpParams)

          followUpResponse = signal
            ? await Promise.race([
                followUpPromise,
                new Promise<never>((_, reject) => {
                  if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'))
                  else signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
                })
              ])
            : await followUpPromise

          logger?.log('API_RESPONSE', JSON.stringify(followUpResponse, null, 2))
        } catch (err) {
          logger?.log('API_ERROR', String(err))
          throw err
        }

        const textContent = followUpResponse.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('')

        logger?.log('RESPONSE', `${followUpResponse.usage.output_tokens} completion tokens`)
        return {
          content: textContent,
          model: followUpResponse.model,
          usage: {
            promptTokens: followUpResponse.usage.input_tokens,
            completionTokens: followUpResponse.usage.output_tokens
          },
          sources,
          toolsUsed
        }
      }
    }

    // Extract text content from response blocks
    const textContent = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')

    logger?.log('RESPONSE', `${response.usage.output_tokens} completion tokens`)
    return {
      content: textContent,
      model: response.model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens
      },
      sources
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
