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
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer — exposed via window.api
const api = {
  sendMessage: (request: {
    providerId?: string
    messages: { role: string; content: string }[]
    context?: { filename: string; content: string; type: string }[]
    selectedTools?: string[]
    projectId?: string
    messageId?: string
  }) => ipcRenderer.invoke('nai:sendMessage', request),

  abortMessage: () => ipcRenderer.send('nai:abort'),
  abortImprove: () => ipcRenderer.send('nai:abortImprove'),
  abortInit: () => ipcRenderer.send('app:abortInit'),

  getDefaultProvider: () => ipcRenderer.invoke('nai:getDefaultProvider'),

  // Project APIs
  listProjects: () => ipcRenderer.invoke('project:list'),
  createProject: (name: string, description?: string) =>
    ipcRenderer.invoke('project:create', name, description),
  selectProjectDirectory: () => ipcRenderer.invoke('project:selectDirectory'),
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id),
  renameProject: (id: string, name: string) => ipcRenderer.invoke('project:rename', id, name),
  getActiveProject: () => ipcRenderer.invoke('project:getActive'),
  setActiveProject: (id: string) => ipcRenderer.invoke('project:setActive', id),
  ensureDefaultProject: () => ipcRenderer.invoke('project:ensureDefault'),

  // Conversation APIs (project-scoped)
  listConversations: (projectId: string) =>
    ipcRenderer.invoke('storage:listConversations', projectId),
  loadConversation: (projectId: string, convId: string) =>
    ipcRenderer.invoke('storage:loadConversation', projectId, convId),
  saveConversation: (projectId: string, conversation: Record<string, unknown>) =>
    ipcRenderer.invoke('storage:saveConversation', projectId, conversation),
  createConversation: (projectId: string, title: string) =>
    ipcRenderer.invoke('storage:createConversation', projectId, title),
  deleteConversation: (projectId: string, convId: string) =>
    ipcRenderer.invoke('storage:deleteConversation', projectId, convId),

  // File APIs
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  parseFile: (filePath: string) => ipcRenderer.invoke('file:parse', filePath),
  importFile: (projectId: string, filePath: string) =>
    ipcRenderer.invoke('file:import', projectId, filePath),
  listProjectFiles: (projectId: string) =>
    ipcRenderer.invoke('file:listProjectFiles', projectId),
  previewFile: (projectId: string, filename: string) =>
    ipcRenderer.invoke('file:previewFile', projectId, filename),
  ocrFile: (projectId: string, filename: string) =>
    ipcRenderer.invoke('file:ocr', projectId, filename),
  previewHtml: (html: string, title: string) => ipcRenderer.invoke('file:previewHtml', html, title),
  watchProject: (projectId: string) => ipcRenderer.invoke('file:watchProject', projectId),
  openProjectDir: (projectId: string) => ipcRenderer.invoke('file:openProjectDir', projectId),
  deleteProjectFile: (projectId: string, filename: string) =>
    ipcRenderer.invoke('file:delete', projectId, filename),
  listMessageLogs: (projectId: string) =>
    ipcRenderer.invoke('file:listMessageLogs', projectId) as Promise<string[]>,
  viewMessageLog: (projectId: string, messageId: string) =>
    ipcRenderer.invoke('file:viewMessageLog', projectId, messageId),

  onProjectFilesChanged: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('projectFiles:changed', handler)
    return () => {
      ipcRenderer.removeListener('projectFiles:changed', handler)
    }
  },

  // Skills APIs
  listSkills: () => ipcRenderer.invoke('skills:list'),
  createSkill: () => ipcRenderer.invoke('skills:create'),
  saveSkill: (filename: string, content: string) =>
    ipcRenderer.invoke('skills:save', filename, content),
  deleteSkill: (path: string) => ipcRenderer.invoke('skills:delete', path),
  renameSkill: (oldPath: string, newPath: string) =>
    ipcRenderer.invoke('skills:rename', oldPath, newPath),
  importSkillPaths: (paths: string[]) => ipcRenderer.invoke('skills:importPaths', paths),

  // Commands APIs
  listCommands: () => ipcRenderer.invoke('commands:list'),
  createCommand: () => ipcRenderer.invoke('commands:create'),
  saveCommand: (filename: string, content: string) =>
    ipcRenderer.invoke('commands:save', filename, content),
  deleteCommand: (filename: string) => ipcRenderer.invoke('commands:delete', filename),
  renameCommand: (oldFilename: string, newFilename: string) =>
    ipcRenderer.invoke('commands:rename', oldFilename, newFilename),

  // Settings APIs
  selectDirectory: (defaultPath?: string) => ipcRenderer.invoke('settings:selectDirectory', defaultPath),
  selectFile: (defaultPath?: string, filters?: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('settings:selectFile', defaultPath, filters),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (config: Record<string, unknown>) =>
    ipcRenderer.invoke('settings:update', config),
  testProvider: (providerId: string) => ipcRenderer.invoke('settings:testProvider', providerId),
  testEmbeddings: (providerId: string) => ipcRenderer.invoke('settings:testEmbeddings', providerId),
  checkProviders: () => ipcRenderer.invoke('settings:checkProviders') as Promise<Record<string, boolean>>,
  listOpenaiLocalModels: () => ipcRenderer.invoke('settings:listOpenaiLocalModels') as Promise<string[]>,
  listEmbeddingModels: (providerId: string) => ipcRenderer.invoke('settings:listEmbeddingModels', providerId) as Promise<string[]>,
  checkAdc: () => ipcRenderer.invoke('settings:checkAdc'),
  loginGoogle: () => ipcRenderer.invoke('settings:loginGoogle'),

  // Real-time project list updates
  onProjectsChanged: (callback: (projects: unknown[]) => void): (() => void) => {
    const handler = (_event: unknown, projects: unknown[]): void => callback(projects)
    ipcRenderer.on('projects:changed', handler)
    return () => {
      ipcRenderer.removeListener('projects:changed', handler)
    }
  },

  // Real-time skills list updates
  onSkillsChanged: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('skills:changed', handler)
    return () => {
      ipcRenderer.removeListener('skills:changed', handler)
    }
  },

  // Real-time commands list updates
  onCommandsChanged: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('commands:changed', handler)
    return () => {
      ipcRenderer.removeListener('commands:changed', handler)
    }
  },

  // Skills File Store sync
  getSkillsFileStoreCount: () => ipcRenderer.invoke('skills:fileStoreCount'),
  listSkillsFileStore: () => ipcRenderer.invoke('skills:listFileStore'),
  purgeSkillsFileStore: () => ipcRenderer.invoke('skills:purgeFileStore'),
  syncSkillsFileStore: () => ipcRenderer.invoke('skills:syncFileStore'),

  onSyncStatus: (callback: (msg: string) => void): (() => void) => {
    const handler = (_event: unknown, msg: string): void => callback(msg)
    ipcRenderer.on('skills:syncStatus', handler)
    return () => {
      ipcRenderer.removeListener('skills:syncStatus', handler)
    }
  },

  onProgress: (callback: (data: { type: string; sources?: { title: string; text?: string }[]; tool?: { name: string; args?: Record<string, unknown>; error?: boolean } }) => void): (() => void) => {
    const handler = (_event: unknown, data: { type: string; sources?: { title: string; text?: string }[]; tool?: { name: string; args?: Record<string, unknown>; error?: boolean } }): void => callback(data)
    ipcRenderer.on('nai:progress', handler)
    return () => {
      ipcRenderer.removeListener('nai:progress', handler)
    }
  },

  onInitStatus: (callback: (msg: string) => void): (() => void) => {
    const handler = (_event: unknown, msg: string): void => callback(msg)
    ipcRenderer.on('app:initStatus', handler)
    return () => {
      ipcRenderer.removeListener('app:initStatus', handler)
    }
  },
  signalRendererReady: () => ipcRenderer.send('app:rendererReady'),
  readAppLog: () => ipcRenderer.invoke('app:readLog'),
  clearAppLog: () => ipcRenderer.invoke('app:clearLog'),

  listPersonas: () => ipcRenderer.invoke('personas:list'),
  createPersona: () => ipcRenderer.invoke('personas:create'),
  savePersona: (filename: string, content: string) =>
    ipcRenderer.invoke('personas:save', filename, content),
  deletePersona: (filename: string) => ipcRenderer.invoke('personas:delete', filename),
  renamePersona: (oldFilename: string, newFilename: string) =>
    ipcRenderer.invoke('personas:rename', oldFilename, newFilename),

  onPersonasChanged: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('personas:changed', handler)
    return () => {
      ipcRenderer.removeListener('personas:changed', handler)
    }
  },

  listTools: () => ipcRenderer.invoke('tools:list'),
  saveTool: (filename: string, content: string) =>
    ipcRenderer.invoke('tools:save', filename, content),
  deleteTool: (filename: string) => ipcRenderer.invoke('tools:delete', filename),
  renameTool: (oldFilename: string, newFilename: string) =>
    ipcRenderer.invoke('tools:rename', oldFilename, newFilename),

  onToolsChanged: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('tools:changed', handler)
    return () => {
      ipcRenderer.removeListener('tools:changed', handler)
    }
  },

  // MCP Server APIs
  listMCPServers: () => ipcRenderer.invoke('mcp:listServers'),
  saveMCPServer: (name: string, configJson: string) =>
    ipcRenderer.invoke('mcp:saveServer', name, configJson),
  deleteMCPServer: (name: string) => ipcRenderer.invoke('mcp:deleteServer', name),
  getMCPStatuses: () => ipcRenderer.invoke('mcp:getStatuses'),
  refreshMCPServer: (name: string) => ipcRenderer.invoke('mcp:refreshServer', name),
  stopMCPServer: (name: string) => ipcRenderer.invoke('mcp:stopServer', name),
  refreshAllMCP: () => ipcRenderer.invoke('mcp:refreshAll'),
  readMCPLog: (name: string) => ipcRenderer.invoke('mcp:readLog', name),
  clearMCPLog: (name: string) => ipcRenderer.invoke('mcp:clearLog', name),
  improveText: (text: string, promptFile: string) => ipcRenderer.invoke('nai:improveText', text, promptFile),
  onMCPChanged: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('mcp:changed', handler)
    return () => {
      ipcRenderer.removeListener('mcp:changed', handler)
    }
  },

  // Export APIs
  exportMessageToDocx: (projectId: string, content: string) =>
    ipcRenderer.invoke('export:messageToDocx', projectId, content),

  // UI State APIs
  getUIState: () => ipcRenderer.invoke('uiState:get'),
  patchUIState: (partial: Record<string, unknown>) => ipcRenderer.invoke('uiState:patch', partial)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
