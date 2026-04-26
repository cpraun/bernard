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
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { JSONFileSyncPreset } from 'lowdb/node'
import { getProjectDir as getConfiguredBaseDir } from './ConfigService'

export interface Project {
  id: string
  name: string
  dirName: string
  description?: string
  source: 'manual' | 'directory'
  createdAt: number
  updatedAt: number
}

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
  selectedContextFiles?: string[]
  agentFilename?: string
  providerId?: string
  vectorDbBackend?: string
  createdAt: number
  updatedAt: number
}

interface ProjectsDB {
  projects: Project[]
  activeProjectId: string | null
}

interface ConversationDB {
  conversations: StoredConversation[]
}

function getBaseDir(): string {
  return getConfiguredBaseDir()
}

function getProjectsDB(): ReturnType<typeof JSONFileSyncPreset<ProjectsDB>> {
  const dbPath = join(getBaseDir(), 'projects.json')
  return JSONFileSyncPreset<ProjectsDB>(dbPath, { projects: [], activeProjectId: null })
}

function toDirectoryName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'project'
}

function uniqueDirectoryName(baseName: string): string {
  const baseDir = getBaseDir()
  let candidate = baseName
  let counter = 1
  while (existsSync(join(baseDir, candidate))) {
    candidate = `${baseName}-${counter++}`
  }
  return candidate
}

export function getProjectDir(projectId: string): string {
  const db = getProjectsDB()
  const project = db.data.projects.find((p) => p.id === projectId)
  // Backward compatibility: old projects without dirName used projects/{uuid}
  let dirName: string
  if (project?.dirName) {
    dirName = project.dirName
  } else {
    const legacyDir = join(getBaseDir(), 'projects', projectId)
    if (existsSync(legacyDir)) {
      dirName = join('projects', projectId)
    } else {
      dirName = projectId
    }
  }
  const dir = join(getBaseDir(), dirName)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getConversationDB(projectId: string): ReturnType<typeof JSONFileSyncPreset<ConversationDB>> {
  const dbPath = join(getProjectDir(projectId), 'conversations.json')
  return JSONFileSyncPreset<ConversationDB>(dbPath, { conversations: [] })
}

// --- Project CRUD ---

export function listProjects(): Project[] {
  const db = getProjectsDB()
  return db.data.projects.map((p) => ({ ...p, source: p.source || 'manual' }))
}

export function createProject(name: string, description?: string): Project {
  const db = getProjectsDB()
  const dirName = uniqueDirectoryName(toDirectoryName(name))
  const project: Project = {
    id: uuidv4(),
    name,
    dirName,
    description,
    source: 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  // Create the project directory
  const dir = join(getBaseDir(), dirName)
  mkdirSync(dir, { recursive: true })
  db.data.projects.push(project)
  if (!db.data.activeProjectId) {
    db.data.activeProjectId = project.id
  }
  db.write()
  return project
}

export function deleteProject(id: string): void {
  const db = getProjectsDB()
  const project = db.data.projects.find((p) => p.id === id)
  // Remove the project directory and all its contents (only for manual projects)
  if (project && (project.source || 'manual') !== 'directory') {
    const dir = getProjectDir(id)
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  db.data.projects = db.data.projects.filter((p) => p.id !== id)
  if (db.data.activeProjectId === id) {
    db.data.activeProjectId = db.data.projects[0]?.id ?? null
  }
  db.write()
}

export function renameProject(id: string, name: string): Project | null {
  const db = getProjectsDB()
  const project = db.data.projects.find((p) => p.id === id)
  if (!project) return null
  project.name = name
  project.updatedAt = Date.now()
  db.write()
  return project
}

export function getActiveProjectId(): string | null {
  const db = getProjectsDB()
  return db.data.activeProjectId
}

export function setActiveProject(id: string): void {
  const db = getProjectsDB()
  db.data.activeProjectId = id
  db.write()
}

export function ensureDefaultProject(): string {
  const db = getProjectsDB()
  if (db.data.projects.length === 0) {
    const project = createProject('default')
    return project.id
  }
  if (!db.data.activeProjectId) {
    db.data.activeProjectId = db.data.projects[0].id
    db.write()
  }
  return db.data.activeProjectId!
}

// --- Directory-synced project helpers ---

export function createProjectForDirectory(dirName: string): Project {
  const db = getProjectsDB()
  const existing = db.data.projects.find((p) => p.dirName === dirName)
  if (existing) return { ...existing, source: existing.source || 'manual' }

  const project: Project = {
    id: uuidv4(),
    name: toDirectoryName(dirName),
    dirName,
    source: 'directory',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  db.data.projects.push(project)
  if (!db.data.activeProjectId) {
    db.data.activeProjectId = project.id
  }
  db.write()
  return project
}

export function removeDirectoryProject(dirName: string): void {
  const db = getProjectsDB()
  const project = db.data.projects.find(
    (p) => p.dirName === dirName && (p.source || 'manual') === 'directory'
  )
  if (!project) return
  db.data.projects = db.data.projects.filter((p) => p.id !== project.id)
  if (db.data.activeProjectId === project.id) {
    db.data.activeProjectId = db.data.projects[0]?.id ?? null
  }
  db.write()
}

export function getDirectoryProjectDirNames(): string[] {
  const db = getProjectsDB()
  return db.data.projects
    .filter((p) => (p.source || 'manual') === 'directory')
    .map((p) => p.dirName)
}

// --- Project-scoped conversation CRUD ---

export function listProjectConversations(projectId: string): StoredConversation[] {
  const db = getConversationDB(projectId)
  return db.data.conversations.map((c) => ({ ...c, messages: [] }))
}

export function loadProjectConversation(projectId: string, convId: string): StoredConversation | null {
  const db = getConversationDB(projectId)
  return db.data.conversations.find((c) => c.id === convId) ?? null
}

export function saveProjectConversation(projectId: string, conversation: StoredConversation): void {
  const db = getConversationDB(projectId)
  const index = db.data.conversations.findIndex((c) => c.id === conversation.id)
  if (index >= 0) {
    db.data.conversations[index] = conversation
  } else {
    db.data.conversations.push(conversation)
  }
  db.write()
}

export function createProjectConversation(projectId: string, title: string): StoredConversation {
  const conversation: StoredConversation = {
    id: uuidv4(),
    title,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  saveProjectConversation(projectId, conversation)
  return conversation
}

export function deleteProjectConversation(projectId: string, convId: string): void {
  const db = getConversationDB(projectId)
  db.data.conversations = db.data.conversations.filter((c) => c.id !== convId)
  db.write()
}
