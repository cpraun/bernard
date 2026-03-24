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
import { join } from 'path'
import { JSONFileSyncPreset } from 'lowdb/node'
import { v4 as uuidv4 } from 'uuid'
import { getProjectDir } from './ConfigService'

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface StoredConversation {
  id: string
  title: string
  messages: StoredMessage[]
  createdAt: number
  updatedAt: number
}

interface ConversationDB {
  conversations: StoredConversation[]
}

function getStorageDir(): string {
  return getProjectDir()
}

function getDB(): ReturnType<typeof JSONFileSyncPreset<ConversationDB>> {
  const dbPath = join(getStorageDir(), 'conversations.json')
  return JSONFileSyncPreset<ConversationDB>(dbPath, { conversations: [] })
}

export function listConversations(): StoredConversation[] {
  const db = getDB()
  // Return without messages for the list view (lighter)
  return db.data.conversations.map((c) => ({
    ...c,
    messages: []
  }))
}

export function loadConversation(id: string): StoredConversation | null {
  const db = getDB()
  return db.data.conversations.find((c) => c.id === id) ?? null
}

export function saveConversation(conversation: StoredConversation): void {
  const db = getDB()
  const index = db.data.conversations.findIndex((c) => c.id === conversation.id)
  if (index >= 0) {
    db.data.conversations[index] = conversation
  } else {
    db.data.conversations.push(conversation)
  }
  db.write()
}

export function createConversation(title: string): StoredConversation {
  const conversation: StoredConversation = {
    id: uuidv4(),
    title,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  saveConversation(conversation)
  return conversation
}

export function deleteConversation(id: string): void {
  const db = getDB()
  db.data.conversations = db.data.conversations.filter((c) => c.id !== id)
  db.write()
}
