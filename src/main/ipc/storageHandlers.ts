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
import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'fs'
import { basename, resolve, sep, join, extname } from 'path'
import { ipcMain, dialog, BrowserWindow } from 'electron'
import {
  listProjects,
  createProject,
  createProjectForDirectory,
  deleteProject,
  renameProject,
  getActiveProjectId,
  setActiveProject,
  ensureDefaultProject,
  listProjectConversations,
  loadProjectConversation,
  saveProjectConversation,
  createProjectConversation,
  deleteProjectConversation,
  type StoredConversation
} from '../services/ProjectService'
import { getProjectDir as getProjectsBaseDir } from '../services/ConfigService'

export function registerStorageHandlers(): void {
  // Project handlers
  ipcMain.handle('project:list', async () => {
    return listProjects()
  })

  ipcMain.handle('project:create', async (_event, name: string, description?: string) => {
    return createProject(name, description)
  })

  ipcMain.handle('project:selectDirectory', async () => {
    const baseDir = resolve(getProjectsBaseDir())
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: baseDir
    })
    if (result.canceled) return null
    const selected = resolve(result.filePaths[0])
    const parent = resolve(selected, '..')

    // Case 1: Selected directory is a direct child of the projects base dir
    if (parent === baseDir) {
      const dirName = basename(selected)
      if (!existsSync(selected)) {
        mkdirSync(selected, { recursive: true })
      }
      const project = createProjectForDirectory(dirName)
      return { project }
    }

    // Case 2: External directory — offer to import context files
    const IMPORT_EXTS = new Set(['.txt', '.md', '.pdf', '.docx', '.eml', '.msg', '.jpg', '.jpeg', '.png'])
    const sourceName = basename(selected)
    const files = readdirSync(selected, { withFileTypes: true })
      .filter((e) => e.isFile() && IMPORT_EXTS.has(extname(String(e.name)).toLowerCase()))
    const fileCount = files.length

    const confirm = await dialog.showMessageBox(win!, {
      type: 'question',
      buttons: ['Import', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Import External Folder',
      message: `Create a new project from "${sourceName}"?`,
      detail: fileCount > 0
        ? `A new project folder will be created and ${fileCount} context file(s) (TXT, MD, PDF, DOCX, EML, MSG, JPG, PNG) will be copied into it.`
        : 'A new project folder will be created. No supported context files were found to copy.'
    })
    if (confirm.response !== 0) return null

    // Create kebab-case project directory
    const kebabName = sourceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'project'
    let dirName = kebabName
    let counter = 1
    while (existsSync(join(baseDir, dirName))) {
      dirName = `${kebabName}-${counter++}`
    }
    const projectDir = join(baseDir, dirName)
    mkdirSync(projectDir, { recursive: true })

    // Copy context files
    for (const entry of files) {
      const srcPath = join(selected, String(entry.name))
      const destPath = join(projectDir, String(entry.name))
      copyFileSync(srcPath, destPath)
    }

    const project = createProjectForDirectory(dirName)
    return { project }
  })

  ipcMain.handle('project:delete', async (_event, id: string) => {
    deleteProject(id)
  })

  ipcMain.handle('project:rename', async (_event, id: string, name: string) => {
    return renameProject(id, name)
  })

  ipcMain.handle('project:getActive', async () => {
    return getActiveProjectId()
  })

  ipcMain.handle('project:setActive', async (_event, id: string) => {
    setActiveProject(id)
  })

  ipcMain.handle('project:ensureDefault', async () => {
    return ensureDefaultProject()
  })

  // Conversation handlers (project-scoped)
  ipcMain.handle('storage:listConversations', async (_event, projectId: string) => {
    return listProjectConversations(projectId)
  })

  ipcMain.handle('storage:loadConversation', async (_event, projectId: string, convId: string) => {
    return loadProjectConversation(projectId, convId)
  })

  ipcMain.handle(
    'storage:saveConversation',
    async (_event, projectId: string, conversation: StoredConversation) => {
      saveProjectConversation(projectId, conversation)
    }
  )

  ipcMain.handle('storage:createConversation', async (_event, projectId: string, title: string) => {
    return createProjectConversation(projectId, title)
  })

  ipcMain.handle('storage:deleteConversation', async (_event, projectId: string, convId: string) => {
    deleteProjectConversation(projectId, convId)
  })
}
