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
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync, renameSync } from 'fs'
import { join, extname, basename, resolve, sep } from 'path'
import { ipcMain, BrowserWindow } from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'
import { getAgentsDir, getConfigDir } from '../services/ConfigService'

// ── Watcher ───────────────────────────────────────────────────────────────────

let agentsWatcher: FSWatcher | null = null
let agentsDebounceTimer: ReturnType<typeof setTimeout> | null = null

function notifyAgentsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('agents:changed')
  }
}

function scheduleAgentsNotification(): void {
  if (agentsDebounceTimer !== null) clearTimeout(agentsDebounceTimer)
  agentsDebounceTimer = setTimeout(() => {
    agentsDebounceTimer = null
    notifyAgentsChanged()
  }, 200)
}

export function stopAgentsWatcher(): void {
  if (agentsDebounceTimer !== null) {
    clearTimeout(agentsDebounceTimer)
    agentsDebounceTimer = null
  }
  if (agentsWatcher) {
    agentsWatcher.close()
    agentsWatcher = null
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

export function registerAgentsHandlers(): void {
  ipcMain.handle('agents:save', async (_event, filename: string, content: string) => {
    const agentsDir = getAgentsDir()
    const resolved = resolve(join(agentsDir, filename))
    if (!resolved.startsWith(resolve(agentsDir) + sep)) {
      throw new Error('Invalid filename')
    }
    writeFileSync(resolved, content, 'utf-8')
  })

  ipcMain.handle('agents:create', async () => {
    const agentsDir = getAgentsDir()
    let filename = 'new-agent.md'
    let counter = 2
    while (existsSync(join(agentsDir, filename))) {
      filename = `new-agent-${counter++}.md`
    }
    const templatePath = join(getConfigDir(), 'new-agent.md')
    const template = existsSync(templatePath)
      ? readFileSync(templatePath, 'utf-8')
      : `---\ndescription: \n---\n\nYou are a helpful assistant.\n`
    writeFileSync(join(agentsDir, filename), template, 'utf-8')
    return filename
  })

  ipcMain.handle('agents:delete', (_event, filename: string) => {
    const agentsDir = getAgentsDir()
    const resolved = resolve(join(agentsDir, filename))
    if (!resolved.startsWith(resolve(agentsDir) + sep)) throw new Error('Invalid filename')
    unlinkSync(resolved)
  })

  ipcMain.handle('agents:rename', (_event, oldFilename: string, newFilename: string) => {
    const agentsDir = getAgentsDir()
    const resolvedOld = resolve(join(agentsDir, oldFilename))
    const resolvedNew = resolve(join(agentsDir, newFilename))
    if (!resolvedOld.startsWith(resolve(agentsDir) + sep)) throw new Error('Invalid filename')
    if (!resolvedNew.startsWith(resolve(agentsDir) + sep)) throw new Error('Invalid filename')
    renameSync(resolvedOld, resolvedNew)
  })

  ipcMain.handle('agents:list', () => {
    const agentsDir = getAgentsDir()

    let fileNames: string[]
    try {
      const entries = readdirSync(agentsDir, { withFileTypes: true })
      fileNames = entries
        .filter((e) => e.isFile() && extname(String(e.name)).toLowerCase() === '.md')
        .map((e) => String(e.name))
        .sort()
    } catch {
      return []
    }

    return fileNames
      .map((filename) => {
        try {
          const content = readFileSync(join(agentsDir, filename), 'utf-8')
          return {
            filename,
            name: basename(filename, '.md'),
            content,
            size: content.length
          }
        } catch {
          return null
        }
      })
      .filter(Boolean)
  })

  // Start watching the agents directory for external file changes
  const agentsDir = getAgentsDir()
  agentsWatcher = chokidar.watch(agentsDir, {
    depth: 0,
    ignoreInitial: true,
    persistent: true,
    ignorePermissionErrors: true
  })
  agentsWatcher.on('add', (p: string) => {
    if (extname(p).toLowerCase() === '.md') scheduleAgentsNotification()
  })
  agentsWatcher.on('unlink', (p: string) => {
    if (extname(p).toLowerCase() === '.md') scheduleAgentsNotification()
  })
  agentsWatcher.on('change', (p: string) => {
    if (extname(p).toLowerCase() === '.md') scheduleAgentsNotification()
  })
}
