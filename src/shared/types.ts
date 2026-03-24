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
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface FileContext {
  filename: string
  content: string
  type: 'text' | 'md' | 'pdf' | 'msg' | 'eml' | 'docx' | 'jpg' | 'png'
  mediaType?: string
}

export interface ToolDefinition {
  name: string
  description?: string
  parameters?: Record<string, unknown>
  _mcpServer?: string
}

export interface MCPServerConfig {
  // Stdio transport fields
  command?: string
  args?: string[]
  env?: Record<string, string>
  // HTTP transport fields
  url?: string
  headers?: Record<string, string>
}

export interface MCPServerStatus {
  name: string
  connected: boolean
  toolCount: number
  remote?: boolean
  error?: string
}

export interface NAIRequest {
  providerId: string
  messages: ChatMessage[]
  context?: FileContext[]
  selectedTools?: string[]
  conditionalTools?: string[]
  projectId?: string
  messageId?: string
}

export interface NAIResponse {
  content: string
  model?: string
  isError?: boolean
  usage?: {
    promptTokens: number
    completionTokens: number
  }
  sources?: { title: string; text?: string }[]
  toolsUsed?: { name: string; args?: Record<string, unknown>; error?: boolean }[]
}
