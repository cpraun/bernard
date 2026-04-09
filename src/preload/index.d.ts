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
import { ElectronAPI } from '@electron-toolkit/preload'

interface NAIRequest {
  providerId?: string
  messages: { role: string; content: string }[]
  context?: { filename: string; content: string; type: string }[]
  selectedTools?: string[]
  conditionalTools?: string[]
  projectId?: string
  messageId?: string
}

interface NAIResponse {
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

interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  sources?: { title: string; text?: string }[]
  toolsUsed?: { name: string; args?: Record<string, unknown>; error?: boolean }[]
}

interface StoredConversation {
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

interface Project {
  id: string
  name: string
  dirName: string
  description?: string
  source?: 'manual' | 'directory'
  createdAt: number
  updatedAt: number
}

interface SkillFile { kind: 'file'; name: string; path: string; content: string; size: number }
interface SkillDir  { kind: 'dir';  name: string; path: string; children: SkillTreeNode[] }
type SkillTreeNode = SkillFile | SkillDir

interface NaiChatAPI {
  sendMessage: (request: NAIRequest) => Promise<NAIResponse>
  abortMessage: () => void
  abortInit: () => void
  abortImprove: () => void
  getDefaultProvider: () => Promise<string>

  // Project APIs
  listProjects: () => Promise<Project[]>
  createProject: (name: string, description?: string) => Promise<Project>
  selectProjectDirectory: () => Promise<{ project: Project } | { error: string } | null>
  deleteProject: (id: string) => Promise<void>
  renameProject: (id: string, name: string) => Promise<Project | null>
  getActiveProject: () => Promise<string | null>
  setActiveProject: (id: string) => Promise<void>
  ensureDefaultProject: () => Promise<string>

  // Conversation APIs (project-scoped)
  listConversations: (projectId: string) => Promise<StoredConversation[]>
  loadConversation: (projectId: string, convId: string) => Promise<StoredConversation | null>
  saveConversation: (projectId: string, conversation: StoredConversation) => Promise<void>
  createConversation: (projectId: string, title: string) => Promise<StoredConversation>
  deleteConversation: (projectId: string, convId: string) => Promise<void>

  // File APIs
  getFilePath: (file: File) => string
  parseFile: (filePath: string) => Promise<{
    filename: string
    content: string
    type: 'text' | 'md' | 'pdf' | 'msg' | 'eml' | 'docx'
    size: number
    contentLength: number
  }>
  importFile: (projectId: string, filePath: string) => Promise<{
    filename: string
    content: string
    type: 'text' | 'md' | 'pdf' | 'msg' | 'eml' | 'docx'
    size: number
    contentLength: number
  }>
  previewFile: (projectId: string, filename: string) => Promise<void>
  ocrFile: (projectId: string, filename: string) => Promise<{ filename: string; content: string; contentLength: number; type: 'text'; size: number }>
  previewHtml: (html: string, title: string) => Promise<void>
  watchProject: (projectId: string) => Promise<void>
  openProjectDir: (projectId: string) => Promise<void>
  deleteProjectFile: (projectId: string, filename: string) => Promise<void>
  listMessageLogs: (projectId: string) => Promise<string[]>
  viewMessageLog: (projectId: string, messageId: string) => Promise<void>
  onProjectFilesChanged: (callback: () => void) => () => void
  listProjectFiles: (projectId: string) => Promise<
    {
      filename: string
      content: string
      type: 'text' | 'md' | 'pdf' | 'msg' | 'eml' | 'docx' | 'jpg' | 'png'
      size: number
      contentLength: number
      mediaType?: string
    }[]
  >

  // Skills APIs
  listSkills: () => Promise<SkillTreeNode[]>
  createSkill: () => Promise<string>
  saveSkill: (path: string, content: string) => Promise<void>
  deleteSkill: (path: string) => Promise<void>
  renameSkill: (oldPath: string, newPath: string) => Promise<void>
  importSkillPaths: (paths: string[]) => Promise<void>

  // Commands APIs
  createCommand: () => Promise<string>
  listCommands: () => Promise<
    {
      filename: string
      name: string
      content: string
      description: string
      agents: string[]
      size: number
    }[]
  >
  saveCommand: (filename: string, content: string) => Promise<void>
  deleteCommand: (filename: string) => Promise<void>
  renameCommand: (oldFilename: string, newFilename: string) => Promise<void>

  // Settings APIs
  selectDirectory: (defaultPath?: string) => Promise<string | null>
  selectFile: (defaultPath?: string, filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
  getSettings: () => Promise<AppConfig>
  updateSettings: (config: AppConfig) => Promise<void>
  testProvider: (providerId: string) => Promise<{
    success: boolean
    model?: string
    displayName?: string
    inputTokenLimit?: number
    outputTokenLimit?: number
    error?: string
  }>
  testEmbeddings: (providerId: string) => Promise<{
    success: boolean
    endpoint?: string
    model?: string
    dim?: number
    error?: string
  }>
  checkProviders: () => Promise<Record<string, boolean>>
  listOpenaiLocalModels: () => Promise<string[]>
  listEmbeddingModels: (providerId: string) => Promise<string[]>
  checkAdc: () => Promise<{ valid: boolean }>
  loginGoogle: () => Promise<{ success: boolean; error?: string }>

  // Real-time project list updates
  onProjectsChanged: (callback: (projects: Project[]) => void) => () => void

  // Real-time skills list updates
  onSkillsChanged: (callback: () => void) => () => void

  // Real-time commands list updates
  onCommandsChanged: (callback: () => void) => () => void

  // Skills File Store sync
  getSkillsFileStoreCount: () => Promise<number>
  listSkillsFileStore: () => Promise<string[]>
  purgeSkillsFileStore: () => Promise<void>
  syncSkillsFileStore: () => Promise<void>
  onSyncStatus: (callback: (msg: string) => void) => () => void
  onProgress: (callback: (data: { type: string; sources?: { title: string; text?: string }[]; tool?: { name: string; args?: Record<string, unknown>; error?: boolean } }) => void) => () => void
  onInitStatus: (callback: (msg: string) => void) => () => void
  signalRendererReady: () => void
  readAppLog: () => Promise<string>
  clearAppLog: () => Promise<boolean>
  listAgents: () => Promise<{ filename: string; name: string; content: string; size: number }[]>
  createAgent: () => Promise<string>
  saveAgent: (filename: string, content: string) => Promise<void>
  deleteAgent: (filename: string) => Promise<void>
  renameAgent: (oldFilename: string, newFilename: string) => Promise<void>
  onAgentsChanged: (callback: () => void) => () => void

  listTools: () => Promise<{ filename: string; name: string; content: string; size: number; serverName?: string; readOnly?: boolean; isMCPConfig?: boolean }[]>
  saveTool: (filename: string, content: string) => Promise<void>
  deleteTool: (filename: string) => Promise<void>
  renameTool: (oldFilename: string, newFilename: string) => Promise<void>
  onToolsChanged: (callback: () => void) => () => void

  // MCP Server APIs
  listMCPServers: () => Promise<{ name: string; filename: string; config: MCPServerConfig }[]>
  saveMCPServer: (name: string, configJson: string) => Promise<void>
  deleteMCPServer: (name: string) => Promise<void>
  getMCPStatuses: () => Promise<MCPServerStatus[]>
  refreshMCPServer: (name: string) => Promise<void>
  stopMCPServer: (name: string) => Promise<void>
  refreshAllMCP: () => Promise<void>
  readMCPLog: (name: string) => Promise<string>
  clearMCPLog: (name: string) => Promise<void>
  improveText: (text: string, promptFile: string) => Promise<string>
  onMCPChanged: (callback: () => void) => () => void

  // Export APIs
  exportMessageToDocx: (projectId: string, content: string) => Promise<string | undefined>

  // UI State APIs
  getUIState: () => Promise<UIState>
  patchUIState: (partial: Partial<UIState>) => Promise<void>
}

interface MCPServerConfig {
  // Stdio transport fields
  command?: string
  args?: string[]
  env?: Record<string, string>
  // HTTP transport fields
  url?: string
  headers?: Record<string, string>
}

interface MCPServerStatus {
  name: string
  connected: boolean
  toolCount: number
  remote?: boolean
  error?: string
}

interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  embeddingModel?: string
  enabled?: boolean
  temperature?: number
  topK?: number
  topP?: number
  maxOutputTokens?: number
  stop?: string[]
  projectId?: string
  region?: string
  endpointId?: string
}

interface VectorDbConfig {
  backend?: 'none' | 'lancedb' | 'gemini'
  embeddingProvider?: 'ollama' | 'openai-local'
  ragTopK?: number
  ragMaxDistance?: number
  enabled?: boolean
}

interface PanelSizes {
  chatSidebar?: number
  agentsSidebar?: number
  commandsSidebar?: number
  skillsSidebar?: number
  toolsSidebar?: number
  contextPanelHeight?: number
  chatInputHeight?: number
}

interface WindowBounds {
  x?: number
  y?: number
  width?: number
  height?: number
  maximized?: boolean
}

interface UIState {
  selectedTools?: string[]
  conditionalTools?: string[]
  panelSizes?: PanelSizes
  collapsedMCPServers?: string[]
  collapsedSkillDirs?: string[]
  runningMCPServers?: string[]
  windowBounds?: WindowBounds
}

interface AppConfig {
  providers: Record<string, ProviderConfig>
  defaultProvider: string
  vectorDb?: VectorDbConfig
  projectDir?: string
  profileDir?: string
  /** @deprecated use profileDir */
  skillsDir?: string
  /** @deprecated use profileDir */
  commandsDir?: string
  showSplashScreen?: boolean
  showWelcomePopup?: boolean
  loggingEnabled?: boolean
  theme?: 'light' | 'dark' | 'auto'
  wordExportTemplatePath?: string
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: NaiChatAPI
  }
}
