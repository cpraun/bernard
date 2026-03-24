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
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  sources?: { title: string; text?: string }[]
  toolsUsed?: { name: string; args?: Record<string, unknown>; error?: boolean }[]
  contextFiles?: string[]
  isError?: boolean
  isPending?: boolean
  promptTokens?: number
  completionTokens?: number
  responseTimeMs?: number
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  selectedContextFiles?: string[]
  personaFilename?: string
  providerId?: string
  vectorDbBackend?: string
  createdAt: number
  updatedAt: number
}
