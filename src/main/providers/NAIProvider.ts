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
import type { ChatMessage, FileContext, NAIResponse, ToolDefinition } from '../../shared/types'
import type { InteractionLogger } from '../services/InteractionLogger'

export interface ModelInfo {
  model?: string
  displayName?: string
  inputTokenLimit?: number
  outputTokenLimit?: number
}

export type ProgressData =
  | { type: 'sources'; sources: { title: string; text?: string }[] }
  | { type: 'toolCall'; tool: { name: string; args?: Record<string, unknown> } }

export type ToolApprovalFn = (toolName: string, args: Record<string, unknown>, result: unknown) => Promise<boolean>

export interface NAIProvider {
  readonly id: string
  readonly name: string
  sendMessage(messages: ChatMessage[], context?: FileContext[], toolDefinitions?: ToolDefinition[], signal?: AbortSignal, onProgress?: (data: ProgressData) => void, logger?: InteractionLogger, onToolApproval?: ToolApprovalFn): Promise<NAIResponse>
  testConnection?(): Promise<ModelInfo>
}
