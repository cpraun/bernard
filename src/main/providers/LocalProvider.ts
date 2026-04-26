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
import type { ModelInfo, NAIProvider } from './NAIProvider'
import type { ChatMessage, FileContext, NAIResponse, ToolDefinition } from '../../shared/types'
import type { InteractionLogger } from '../services/InteractionLogger'
import { executeToolCall, isToolError, BUILTIN_SERVER } from '../services/ToolExecutionService'
import type { ToolExecutionContext } from '../services/ToolExecutionService'
import { getBuiltinToolsDir } from '../services/ConfigService'

export type RAGQueryFn = (text: string) => Promise<{ title: string; text: string }[]>

/** Maximum number of parallel tool calls executed per round. Guards against models that repeat the same call many times. */
const MAX_PARALLEL_TOOLS = 10

/**
 * Gemma-specific tool-call fallback parser.
 *
 * Gemma models served via LM Studio may encode tool calls as plain text in
 * `content` rather than populating the OpenAI `tool_calls` field.  This
 * function recognises both known Gemma formats and converts each occurrence
 * into a synthetic OpenAI-style tool-call object for the rest of the pipeline.
 *
 * **Gemma 3** (backtick-fenced block):
 *   ```tool_request]
 *   {"name": "<toolName>", "arguments": { ... }}
 *   [END_TOOL_REQUEST]
 *
 * **Gemma 4** (XML-style tag, emitted when LM Studio "Tool Call Format" is set
 *   to "native" / "disabled" so no OpenAI conversion is applied):
 *   <tool_call>
 *   {"name": "<toolName>", "arguments": { ... }}
 *   </tool_call>
 *
 * NOTE: This fallback only fires when `tool_calls` is empty.  If LM Studio
 * successfully converts to OpenAI format the standard path takes priority and
 * this function is never called.
 */
function parseGemmaToolCalls(content: string): { id: string; function: { name: string; arguments: string } }[] {
  const results: { id: string; function: { name: string; arguments: string } }[] = []
  let match: RegExpExecArray | null
  let index = 0

  // Gemma 3: ```tool_request] / ```tool_request  …  [END_TOOL_REQUEST] / ```
  const gemma3Pattern = /```tool_request\]?\s*(\{[\s\S]*?\})\s*(?:\[END_TOOL_REQUEST\]|```)/g
  while ((match = gemma3Pattern.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as { name?: string; arguments?: Record<string, unknown> }
      if (typeof parsed.name === 'string') {
        results.push({
          id: `gemma-tool-${Date.now()}-${index++}`,
          function: { name: parsed.name, arguments: JSON.stringify(parsed.arguments ?? {}) }
        })
      }
    } catch {
      // Malformed JSON — skip
    }
  }

  // Gemma 4: <tool_call> … </tool_call>
  const gemma4Pattern = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/gi
  while ((match = gemma4Pattern.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as { name?: string; arguments?: Record<string, unknown> }
      if (typeof parsed.name === 'string') {
        results.push({
          id: `gemma-tool-${Date.now()}-${index++}`,
          function: { name: parsed.name, arguments: JSON.stringify(parsed.arguments ?? {}) }
        })
      }
    } catch {
      // Malformed JSON — skip
    }
  }

  return results
}

export class LocalProvider implements NAIProvider {
  readonly id = 'openai-local'
  readonly name = 'OpenAI Local'
  private baseUrl: string
  private model?: string
  private temperature?: number
  private topP?: number
  private maxOutputTokens?: number
  private reasoningEffort?: 'low' | 'medium' | 'high'
  private queryRAG?: RAGQueryFn

  constructor(
    baseUrl = 'http://localhost:1234/v1',
    queryRAG?: RAGQueryFn,
    model?: string,
    temperature?: number,
    topP?: number,
    maxOutputTokens?: number,
    reasoningEffort?: 'low' | 'medium' | 'high'
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.model = model
    this.temperature = temperature
    this.topP = topP
    this.maxOutputTokens = maxOutputTokens
    this.reasoningEffort = reasoningEffort
    this.queryRAG = queryRAG
  }

  async testConnection(): Promise<ModelInfo> {
    let modelId: string

    if (this.model) {
      // Use the explicitly configured model
      modelId = this.model
    } else {
      // No model configured: pick the first non-embedding model from the server
      const res = await fetch(`${this.baseUrl}/models`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new Error(`OpenAI Local error ${res.status}: ${await res.text()}`)
      const json = (await res.json()) as { data?: { id: string }[] }
      const models = json.data ?? []
      if (models.length === 0) throw new Error('No models loaded on the server.')
      const chatModel = models.find((m) => !/embed/i.test(m.id))
      if (!chatModel) throw new Error('No chat models loaded on the server.')
      modelId = chatModel.id
    }

    // Send a minimal chat request to confirm the model responds
    const chatRes = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        max_tokens: 100
      }),
      signal: AbortSignal.timeout(30000)
    })
    if (!chatRes.ok) throw new Error(`Model "${modelId}" failed: ${chatRes.status}: ${await chatRes.text()}`)
    const chatJson = (await chatRes.json()) as { choices?: { message?: { content?: string; reasoning_content?: string } }[] }
    const msg = chatJson.choices?.[0]?.message
    // Accept either content or reasoning_content (reasoning models such as Gemma 4 return
    // their output in reasoning_content and leave content as an empty string)
    if (!msg || (msg.content === undefined && msg.reasoning_content === undefined)) {
      throw new Error(`Model "${modelId}" returned an empty response.`)
    }

    return { model: modelId, displayName: modelId }
  }

  async sendMessage(messages: ChatMessage[], context?: FileContext[], toolDefinitions?: ToolDefinition[], signal?: AbortSignal, onProgress?: (data: import('./NAIProvider').ProgressData) => void, logger?: InteractionLogger, onToolApproval?: import('./NAIProvider').ToolApprovalFn): Promise<NAIResponse> {
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
          console.error('[LocalProvider] RAG query failed:', err)
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
        // Multimodal: OpenAI vision format with content array
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const contentParts: any[] = []
        if (textFiles.length > 0) {
          let prefix = 'Context files:\n\n'
          for (const file of textFiles) {
            prefix += `--- ${file.filename} (${file.type}) ---\n${file.content}\n\n`
          }
          prefix += '---\n\n'
          contentParts.push({ type: 'text', text: prefix })
        }
        for (const img of imageFiles) {
          contentParts.push({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.content}` } })
        }
        contentParts.push({ type: 'text', text: last.content })
        apiMessages[apiMessages.length - 1] = { ...last, content: contentParts }
      } else {
        let prefix = 'Context files:\n\n'
        for (const file of textFiles) {
          prefix += `--- ${file.filename} (${file.type}) ---\n${file.content}\n\n`
        }
        prefix += '---\n\n'
        apiMessages[apiMessages.length - 1] = { ...last, content: prefix + last.content }
      }
    }

    // Build OpenAI-format tools array from tool definitions
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
    logger?.log('API_CALL', `model=${this.model ?? 'auto'}`)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = { messages: apiMessages }
    if (this.model) body.model = this.model
    if (this.temperature !== undefined) body.temperature = this.temperature
    if (this.topP !== undefined) body.top_p = this.topP
    if (this.maxOutputTokens !== undefined) body.max_tokens = this.maxOutputTokens
    if (this.reasoningEffort) body.reasoning_effort = this.reasoningEffort
    if (tools) body.tools = tools

    logger?.log('API_REQUEST', JSON.stringify(body, null, 2))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
      })
      if (!res.ok) throw new Error(`OpenAI Local error ${res.status}: ${await res.text()}`)
      json = (await res.json()) as any
      logger?.log('API_RESPONSE', JSON.stringify(json, null, 2))
    } catch (err) {
      logger?.log('API_ERROR', String(err))
      throw err
    }
    let choice = json.choices[0]
    const toolsUsed: { name: string; args?: Record<string, unknown>; error?: boolean }[] = []
    const MAX_TOOL_ROUNDS = 10

    const execContext: ToolExecutionContext = {
      runSubAgent: (prompt, subSignal, model) => this.runSubAgent(prompt, subSignal ?? signal, model)
    }

    // Loop to handle chained and parallel tool calls
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let toolCalls = choice.message?.tool_calls as { id: string; function: { name: string; arguments: string } }[] | undefined

      // Gemma fallback: if the model returned no structured tool_calls but encoded
      // the call as plain text in content, parse it out (Gemma-specific format).
      if ((!toolCalls || toolCalls.length === 0) && choice.message?.content) {
        const gemmaToolCalls = parseGemmaToolCalls(choice.message.content)
        if (gemmaToolCalls.length > 0) {
          console.log(`[LocalProvider] Gemma text-based tool call(s) detected, converting to structured calls`)
          toolCalls = gemmaToolCalls
          // Rewrite the message so the follow-up conversation looks like a normal
          // assistant tool-call turn (empty content, populated tool_calls).
          choice.message = { ...choice.message, content: '', tool_calls: gemmaToolCalls }
        }
      }

      if (!toolCalls || toolCalls.length === 0) break

      // Deduplicate: keep only the first occurrence of each identical name+arguments pair.
      // Some models (e.g. Gemma 4) repeat the same call dozens or hundreds of times.
      const seenCalls = new Set<string>()
      toolCalls = toolCalls.filter(tc => {
        const key = `${tc.function.name}:${tc.function.arguments}`
        if (seenCalls.has(key)) return false
        seenCalls.add(key)
        return true
      })
      if (toolCalls.length > MAX_PARALLEL_TOOLS) {
        console.warn(`[LocalProvider] Capping ${toolCalls.length} parallel tool calls to ${MAX_PARALLEL_TOOLS} per round`)
        toolCalls = toolCalls.slice(0, MAX_PARALLEL_TOOLS)
      }

      // Append the assistant message (with tool_calls) to conversation
      apiMessages.push(choice.message)

      // Execute all tool calls in this round (may be parallel)
      for (const tc of toolCalls) {
        const fcName: string = tc.function.name
        const fcArgs: Record<string, unknown> = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments ?? {}
        onProgress?.({ type: 'toolCall', tool: { name: fcName, args: fcArgs } })
        logger?.log('TOOL_CALL', `${fcName}(${JSON.stringify(fcArgs)})`)

        let functionResult: Record<string, unknown>
        try {
          const toolDef = toolDefinitions?.find(t => t.name === fcName)
          functionResult = await executeToolCall(fcName, fcArgs, toolDef?._mcpServer, execContext) as Record<string, unknown>
          const errCheck = isToolError(functionResult)
          if (errCheck.isError) {
            console.error(`[LocalProvider] Tool "${fcName}" returned error:`, errCheck.message)
            logger?.log('TOOL_ERROR', `${fcName} — ${errCheck.message}`)
            toolsUsed.push({ name: fcName, args: fcArgs, error: true })
          } else {
            logger?.log('TOOL_RESULT', JSON.stringify(functionResult))
            toolsUsed.push({ name: fcName, args: fcArgs })

            if (onToolApproval) {
              const approved = await onToolApproval(fcName, fcArgs, functionResult)
              if (!approved) {
                logger?.log('TOOL_DECLINED', `User declined to send result of "${fcName}" to AI`)
                return {
                  content: `Tool call "${fcName}" was executed successfully, but the user declined to send the result to the AI provider.`,
                  model: json.model,
                  isError: true,
                  toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined
                }
              }
            }
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') throw err
          console.error(`[LocalProvider] Tool "${fcName}" execution failed:`, err)
          functionResult = { error: String(err) }
          logger?.log('TOOL_ERROR', `${fcName} — ${String(err)}`)
          toolsUsed.push({ name: fcName, args: fcArgs, error: true })
        }

        apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(functionResult) })
      }

      logger?.log('API_CALL', `follow-up after ${toolCalls.length} tool(s), round ${round}`)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nextBody: any = { messages: apiMessages }
      if (this.model) nextBody.model = this.model
      if (this.temperature !== undefined) nextBody.temperature = this.temperature
      if (this.topP !== undefined) nextBody.top_p = this.topP
      if (this.maxOutputTokens !== undefined) nextBody.max_tokens = this.maxOutputTokens
      if (this.reasoningEffort) nextBody.reasoning_effort = this.reasoningEffort
      if (tools) nextBody.tools = tools

      logger?.log('API_REQUEST', JSON.stringify(nextBody, null, 2))

      try {
        const nextRes = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextBody),
          signal
        })
        if (!nextRes.ok) throw new Error(`OpenAI Local error ${nextRes.status}: ${await nextRes.text()}`)
        json = (await nextRes.json()) as any
        logger?.log('API_RESPONSE', JSON.stringify(json, null, 2))
      } catch (err) {
        logger?.log('API_ERROR', String(err))
        throw err
      }
      choice = json.choices[0]
    }

    logger?.log('RESPONSE', `${json.usage?.completion_tokens ?? 0} completion tokens`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reasoning = (choice.message as any).reasoning_content as string | undefined
    return {
      content: choice.message.content ?? '',
      reasoning: reasoning || undefined,
      model: json.model,
      usage: json.usage
        ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens }
        : undefined,
      sources,
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined
    }
  }

  /**
   * Run a sub-agent agentic loop using the same OpenAI-compatible endpoint.
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

    // Load all built-in tool schemas in OpenAI format
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

    const MAX_TOOL_ROUNDS = 10
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: any = { messages, tools }
      if (model) body.model = model
      if (this.maxOutputTokens !== undefined) body.max_tokens = this.maxOutputTokens

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
      })
      if (!res.ok) throw new Error(`OpenAI Local error ${res.status}: ${await res.text()}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await res.json()) as any
      const choice = json.choices[0]

      let toolCalls = choice.message?.tool_calls as { id: string; function: { name: string; arguments: string } }[] | undefined

      // Gemma fallback: same as in sendMessage
      if ((!toolCalls || toolCalls.length === 0) && choice.message?.content) {
        const gemmaToolCalls = parseGemmaToolCalls(choice.message.content)
        if (gemmaToolCalls.length > 0) {
          toolCalls = gemmaToolCalls
          choice.message = { ...choice.message, content: '', tool_calls: gemmaToolCalls }
        }
      }

      if (!toolCalls || toolCalls.length === 0) {
        return choice.message?.content ?? ''
      }

      // Deduplicate and cap — same guard as in sendMessage
      const seenSubCalls = new Set<string>()
      toolCalls = toolCalls.filter(tc => {
        const key = `${tc.function.name}:${tc.function.arguments}`
        if (seenSubCalls.has(key)) return false
        seenSubCalls.add(key)
        return true
      })
      if (toolCalls.length > MAX_PARALLEL_TOOLS) {
        console.warn(`[LocalProvider/runSubAgent] Capping ${toolCalls.length} parallel tool calls to ${MAX_PARALLEL_TOOLS}`)
        toolCalls = toolCalls.slice(0, MAX_PARALLEL_TOOLS)
      }

      messages.push(choice.message)

      const subContext: ToolExecutionContext = {
        runSubAgent: (p, s, m) => this.runSubAgent(p, s, m, depth + 1)
      }

      for (const tc of toolCalls) {
        const fcName = tc.function.name
        const fcArgs: Record<string, unknown> = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments ?? {}

        const toolResult = await executeToolCall(fcName, fcArgs, BUILTIN_SERVER, subContext)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) })
      }
    }

    return ''
  }

  /**
   * Convert Gemini-style parameter schema (uppercase types) to OpenAI JSON Schema (lowercase types).
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
    if (!Array.isArray(result.items) && result.items && typeof result.items === 'object') {
      result.items = this.convertParameters(result.items as Record<string, unknown>)
    }
    return result
  }

}
