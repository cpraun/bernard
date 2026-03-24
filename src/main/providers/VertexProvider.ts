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
import { GoogleAuth } from 'google-auth-library'
import type { ModelInfo, NAIProvider } from './NAIProvider'
import type { ChatMessage, FileContext, NAIResponse, ToolDefinition } from '../../shared/types'
import type { InteractionLogger } from '../services/InteractionLogger'
import { executeToolCall, isToolError } from '../services/ToolExecutionService'

export type RAGQueryFn = (text: string) => Promise<{ title: string; text: string }[]>

// Marker used to detect tool-call JSON in model output
const TOOL_CALL_MARKER = '```tool_calls'
const TOOL_CALL_END = '```'

export class VertexProvider implements NAIProvider {
  readonly id = 'vertex'
  readonly name = 'Google Vertex'
  private projectId: string
  private region: string
  private endpointId: string
  private temperature?: number
  private topP?: number
  private topK?: number
  private maxOutputTokens?: number
  private stop?: string[]
  private auth: GoogleAuth
  private queryRAG?: RAGQueryFn

  constructor(
    projectId: string,
    region: string,
    endpointId: string,
    temperature?: number,
    topP?: number,
    topK?: number,
    maxOutputTokens?: number,
    stop?: string[],
    queryRAG?: RAGQueryFn
  ) {
    this.projectId = projectId
    this.region = region
    this.endpointId = endpointId
    this.temperature = temperature
    this.topP = topP
    this.topK = topK
    this.maxOutputTokens = maxOutputTokens
    this.stop = stop
    this.queryRAG = queryRAG
    this.auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    })
  }

  /** Dedicated endpoint URL for rawPredict (model inference). */
  private get endpointUrl(): string {
    return `https://${this.endpointId}.${this.region}-${this.projectId}.prediction.vertexai.goog/v1/projects/${this.projectId}/locations/${this.region}/endpoints/${this.endpointId}:rawPredict`
  }

  /** Standard Vertex AI API URL for endpoint management (inspect, get info). */
  private get managementUrl(): string {
    return `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/endpoints/${this.endpointId}`
  }

  private async getAccessToken(): Promise<string> {
    console.log('[VertexProvider] Obtaining access token via ADC...')
    const client = await this.auth.getClient()
    const tokenResponse = await client.getAccessToken()
    if (!tokenResponse.token) throw new Error('Failed to obtain access token via ADC')
    console.log('[VertexProvider] Access token obtained successfully')
    return tokenResponse.token
  }

  /** Convert chat messages into a single prompt string for text-completions endpoints. */
  private messagesToPrompt(
    messages: { role: string; content: string }[],
    toolDefinitions?: ToolDefinition[]
  ): string {
    let prompt = ''

    // Inject tool definitions into the system context
    if (toolDefinitions && toolDefinitions.length > 0) {
      prompt += 'You have access to the following tools. To call a tool, output a fenced block exactly like this:\n'
      prompt += '```tool_calls\n[{"name": "tool_name", "arguments": {"arg": "value"}}]\n```\n\n'
      prompt += 'Available tools:\n'
      for (const t of toolDefinitions) {
        prompt += `- ${t.name}`
        if (t.description) prompt += `: ${t.description}`
        if (t.parameters) prompt += `\n  Parameters: ${JSON.stringify(t.parameters)}`
        prompt += '\n'
      }
      prompt += '\nOnly use tools when necessary. After receiving tool results, provide your final answer.\n\n'
    }

    for (const m of messages) {
      if (m.role === 'system') {
        prompt += `${m.content}\n\n`
      } else if (m.role === 'user') {
        prompt += `### User\n${m.content}\n\n`
      } else if (m.role === 'assistant') {
        prompt += `### Assistant\n${m.content}\n\n`
      } else if (m.role === 'tool_result') {
        prompt += `### Tool Result\n${m.content}\n\n`
      }
    }
    prompt += '### Assistant\n'
    return prompt
  }

  /** Parse tool-call JSON blocks from model output text. */
  private parseToolCalls(text: string): { name: string; arguments: Record<string, unknown> }[] | null {
    const startIdx = text.indexOf(TOOL_CALL_MARKER)
    if (startIdx === -1) return null
    const jsonStart = startIdx + TOOL_CALL_MARKER.length
    const endIdx = text.indexOf(TOOL_CALL_END, jsonStart)
    if (endIdx === -1) return null
    const jsonStr = text.substring(jsonStart, endIdx).trim()
    try {
      const parsed = JSON.parse(jsonStr)
      if (Array.isArray(parsed)) return parsed
      if (parsed && typeof parsed === 'object' && parsed.name) return [parsed]
      return null
    } catch {
      return null
    }
  }

  /** Build the request body with generation parameters. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildBody(prompt: string): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = { prompt }
    if (this.temperature !== undefined) body.temperature = this.temperature
    if (this.topP !== undefined) body.top_p = this.topP
    if (this.topK !== undefined) body.top_k = this.topK
    if (this.maxOutputTokens !== undefined) body.max_tokens = this.maxOutputTokens
    if (this.stop && this.stop.length > 0) body.stop = this.stop
    return body
  }

  /** Send a request to the endpoint and return parsed JSON. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async rawRequest(body: any, token: string, signal?: AbortSignal): Promise<any> {
    console.log('[VertexProvider] rawRequest URL:', this.endpointUrl)
    console.log('[VertexProvider] rawRequest body keys:', Object.keys(body))
    const res = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body),
      signal
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error('[VertexProvider] rawRequest failed:', res.status, errText)
      throw new Error(`Vertex API error ${res.status}: ${errText}`)
    }
    const json = (await res.json()) as any
    console.log('[VertexProvider] rawRequest response keys:', Object.keys(json))
    return json
  }

  /** Extract the generated text from the API response. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractText(json: any): string {
    let raw: string | undefined

    // Vertex custom endpoint: { predictions: ["Prompt:...\nOutput:\n..."] }
    if (Array.isArray(json.predictions) && json.predictions.length > 0) {
      raw = String(json.predictions[0])
    }
    // OpenAI chat completions format
    else if (json.choices?.[0]?.message?.content) raw = json.choices[0].message.content
    // OpenAI text completions format
    else if (json.choices?.[0]?.text) raw = json.choices[0].text
    // Simple text fields
    else if (typeof json.text === 'string') raw = json.text
    else if (typeof json.output === 'string') raw = json.output
    else if (typeof json.generated_text === 'string') raw = json.generated_text

    if (!raw) return JSON.stringify(json)

    // Strip echoed prompt: the model may echo the full prompt followed by "Output:\n"
    const outputMarker = 'Output:\n'
    const outputIdx = raw.lastIndexOf(outputMarker)
    if (outputIdx !== -1) {
      raw = raw.substring(outputIdx + outputMarker.length)
    }
    // Also handle "### Assistant\n" marker at the boundary
    const assistantMarker = '### Assistant\n'
    const assistantIdx = raw.lastIndexOf(assistantMarker)
    if (assistantIdx !== -1) {
      raw = raw.substring(assistantIdx + assistantMarker.length)
    }

    return raw.trim()
  }

  async testConnection(): Promise<ModelInfo> {
    console.log('[VertexProvider] testConnection: fetching endpoint info via management API')
    console.log('[VertexProvider] Management URL:', this.managementUrl)
    const token = await this.getAccessToken()
    const res = await fetch(this.managementUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error('[VertexProvider] testConnection failed:', res.status, errText)
      throw new Error(`Vertex API error ${res.status}: ${errText}`)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json()) as any
    console.log('[VertexProvider] Endpoint info:', JSON.stringify(json, null, 2))

    const deployedModels: { id: string; model: string; displayName?: string; trafficSplit?: number }[] = []
    if (json.deployedModels && Array.isArray(json.deployedModels)) {
      const trafficSplit = json.trafficSplit ?? {}
      for (const dm of json.deployedModels) {
        deployedModels.push({
          id: dm.id ?? 'unknown',
          model: dm.model ?? 'unknown',
          displayName: dm.displayModelName ?? dm.modelDisplayName ?? dm.model,
          trafficSplit: trafficSplit[dm.id] ?? 0
        })
      }
    }

    const endpointName = json.displayName ?? this.endpointId
    let displayParts = [`Endpoint: ${endpointName}`]
    if (deployedModels.length > 0) {
      for (const dm of deployedModels) {
        const modelShort = dm.model.split('/').pop() ?? dm.model
        displayParts.push(`  Model: ${dm.displayName ?? modelShort} (id=${dm.id}, traffic=${dm.trafficSplit}%)`)
      }
    } else {
      displayParts.push('  No models deployed')
    }
    const displayName = displayParts.join('\n')
    console.log('[VertexProvider] testConnection result:\n' + displayName)

    return {
      model: deployedModels.length > 0 ? deployedModels[0].model.split('/').pop() ?? this.endpointId : this.endpointId,
      displayName
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
    const apiMessages: { role: string; content: string }[] = messages.map((m) => ({
      role: m.role,
      content: m.content
    }))

    // RAG: query local vector store
    let sources: { title: string; text?: string }[] | undefined
    if (this.queryRAG) {
      const lastUserMsg = apiMessages.filter((m) => m.role === 'user').pop()
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
          console.error('[VertexProvider] RAG query failed:', err)
        }
      }
    }
    if (sources && sources.length > 0) {
      onProgress?.({ type: 'sources', sources })
      logger?.log('RAG_SOURCES', sources.map((s) => s.title).join(', '))
    }

    // Prepend context files to the last user message
    if (context && context.length > 0) {
      logger?.log('CONTEXT_FILES', context.map((f) => f.filename).join(', '))
      const textFiles = context.filter(f => !f.mediaType)
      const imageFiles = context.filter(f => f.mediaType)

      if (imageFiles.length > 0) {
        console.warn('[VertexProvider] Image context files are not supported with rawPredict endpoint — skipping:', imageFiles.map(f => f.filename).join(', '))
      }

      if (textFiles.length > 0) {
        let prefix = 'Context files:\n\n'
        for (const file of textFiles) {
          prefix += `--- ${file.filename} (${file.type}) ---\n${file.content}\n\n`
        }
        prefix += '---\n\n'
        const last = apiMessages[apiMessages.length - 1]
        apiMessages[apiMessages.length - 1] = { ...last, content: prefix + last.content }
      }
    }

    const hasTools = toolDefinitions && toolDefinitions.length > 0
    if (hasTools) logger?.log('TOOLS_AVAILABLE', toolDefinitions!.map((t) => t.name).join(', '))
    logger?.log('API_CALL', `endpoint=${this.endpointId}`)
    console.log('[VertexProvider] sendMessage: building prompt from', apiMessages.length, 'messages')

    // Build prompt from messages
    let prompt = this.messagesToPrompt(apiMessages, hasTools ? toolDefinitions : undefined)
    const body = this.buildBody(prompt)

    console.log('[VertexProvider] sendMessage: prompt length =', prompt.length, 'chars')
    logger?.log('API_REQUEST', JSON.stringify(body, null, 2))

    const token = await this.getAccessToken()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any
    try {
      console.log('[VertexProvider] sendMessage: sending request to endpoint...')
      json = await this.rawRequest(body, token, signal)
      logger?.log('API_RESPONSE', JSON.stringify(json, null, 2))
    } catch (err) {
      console.error('[VertexProvider] sendMessage: request failed:', err)
      logger?.log('API_ERROR', String(err))
      throw err
    }

    let responseText = this.extractText(json)
    console.log('[VertexProvider] sendMessage: response text length =', responseText.length)
    const toolsUsed: { name: string; args?: Record<string, unknown>; error?: boolean }[] = []
    const MAX_TOOL_ROUNDS = 10

    // Loop to handle prompt-based tool calls
    if (hasTools) {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const toolCalls = this.parseToolCalls(responseText)
        if (!toolCalls || toolCalls.length === 0) break

        // Append the assistant's response (with tool call) to the conversation
        apiMessages.push({ role: 'assistant', content: responseText })

        for (const tc of toolCalls) {
          const fcName = tc.name
          const fcArgs = tc.arguments ?? {}
          onProgress?.({ type: 'toolCall', tool: { name: fcName, args: fcArgs } })
          logger?.log('TOOL_CALL', `${fcName}(${JSON.stringify(fcArgs)})`)

          let functionResult: Record<string, unknown>
          try {
            const toolDef = toolDefinitions?.find((t) => t.name === fcName)
            functionResult = (await executeToolCall(
              fcName,
              fcArgs,
              toolDef?._mcpServer
            )) as Record<string, unknown>
            const errCheck = isToolError(functionResult)
            if (errCheck.isError) {
              console.error(`[VertexProvider] Tool "${fcName}" returned error:`, errCheck.message)
              logger?.log('TOOL_ERROR', `${fcName} — ${errCheck.message}`)
              toolsUsed.push({ name: fcName, args: fcArgs, error: true })
            } else {
              logger?.log('TOOL_RESULT', JSON.stringify(functionResult))
              toolsUsed.push({ name: fcName, args: fcArgs })

              if (onToolApproval) {
                const approved = await onToolApproval(fcName, fcArgs, functionResult)
                if (!approved) {
                  logger?.log(
                    'TOOL_DECLINED',
                    `User declined to send result of "${fcName}" to AI`
                  )
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
            console.error(`[VertexProvider] Tool "${fcName}" execution failed:`, err)
            functionResult = { error: String(err) }
            logger?.log('TOOL_ERROR', `${fcName} — ${String(err)}`)
            toolsUsed.push({ name: fcName, args: fcArgs, error: true })
          }

          apiMessages.push({
            role: 'tool_result',
            content: `Result of ${fcName}: ${JSON.stringify(functionResult)}`
          })
        }

        logger?.log('API_CALL', `follow-up after ${toolCalls.length} tool(s), round ${round}`)

        // Rebuild prompt with tool results appended
        prompt = this.messagesToPrompt(apiMessages, toolDefinitions)
        const nextBody = this.buildBody(prompt)
        logger?.log('API_REQUEST', JSON.stringify(nextBody, null, 2))

        const nextToken = await this.getAccessToken()
        try {
          json = await this.rawRequest(nextBody, nextToken, signal)
          logger?.log('API_RESPONSE', JSON.stringify(json, null, 2))
        } catch (err) {
          logger?.log('API_ERROR', String(err))
          throw err
        }
        responseText = this.extractText(json)
      }
    }

    // Strip any remaining tool_calls markers from the final response
    let cleanText = responseText
    const markerIdx = cleanText.indexOf(TOOL_CALL_MARKER)
    if (markerIdx !== -1) {
      cleanText = cleanText.substring(0, markerIdx).trim()
    }

    logger?.log('RESPONSE', `${json.usage?.completion_tokens ?? 0} completion tokens`)
    return {
      content: cleanText,
      model: json.model,
      usage: json.usage
        ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens }
        : undefined,
      sources,
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined
    }
  }
}
