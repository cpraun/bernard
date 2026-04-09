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
import { getPersonasDir, getConfigDir } from '../services/ConfigService'

// ── Watcher ───────────────────────────────────────────────────────────────────

let personasWatcher: FSWatcher | null = null
let personasDebounceTimer: ReturnType<typeof setTimeout> | null = null

function notifyPersonasChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('personas:changed')
  }
}

function schedulePersonasNotification(): void {
  if (personasDebounceTimer !== null) clearTimeout(personasDebounceTimer)
  personasDebounceTimer = setTimeout(() => {
    personasDebounceTimer = null
    notifyPersonasChanged()
  }, 200)
}

export function stopPersonasWatcher(): void {
  if (personasDebounceTimer !== null) {
    clearTimeout(personasDebounceTimer)
    personasDebounceTimer = null
  }
  if (personasWatcher) {
    personasWatcher.close()
    personasWatcher = null
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

export function registerPersonasHandlers(): void {
  ipcMain.handle('personas:save', async (_event, filename: string, content: string) => {
    const personasDir = getPersonasDir()
    const resolved = resolve(join(personasDir, filename))
    if (!resolved.startsWith(resolve(personasDir) + sep)) {
      throw new Error('Invalid filename')
    }
    writeFileSync(resolved, content, 'utf-8')
  })

  ipcMain.handle('personas:create', async () => {
    const personasDir = getPersonasDir()
    let filename = 'new-persona.md'
    let counter = 2
    while (existsSync(join(personasDir, filename))) {
      filename = `new-persona-${counter++}.md`
    }
    const templatePath = join(getConfigDir(), 'new-persona.md')
    const template = existsSync(templatePath)
      ? readFileSync(templatePath, 'utf-8')
      : `---\ndescription: \n---\n\nYou are a helpful assistant.\n`
    writeFileSync(join(personasDir, filename), template, 'utf-8')
    return filename
  })

  ipcMain.handle('personas:delete', (_event, filename: string) => {
    const personasDir = getPersonasDir()
    const resolved = resolve(join(personasDir, filename))
    if (!resolved.startsWith(resolve(personasDir) + sep)) throw new Error('Invalid filename')
    unlinkSync(resolved)
  })

  ipcMain.handle('personas:rename', (_event, oldFilename: string, newFilename: string) => {
    const personasDir = getPersonasDir()
    const resolvedOld = resolve(join(personasDir, oldFilename))
    const resolvedNew = resolve(join(personasDir, newFilename))
    if (!resolvedOld.startsWith(resolve(personasDir) + sep)) throw new Error('Invalid filename')
    if (!resolvedNew.startsWith(resolve(personasDir) + sep)) throw new Error('Invalid filename')
    renameSync(resolvedOld, resolvedNew)
  })

  ipcMain.handle('personas:list', () => {
    const personasDir = getPersonasDir()

    let fileNames: string[]
    try {
      const entries = readdirSync(personasDir, { withFileTypes: true })
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
          const content = readFileSync(join(personasDir, filename), 'utf-8')
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

  // Start watching the personas directory for external file changes
  const personasDir = getPersonasDir()
  personasWatcher = chokidar.watch(personasDir, {
    depth: 0,
    ignoreInitial: true,
    persistent: true,
    ignorePermissionErrors: true
  })
  personasWatcher.on('add', (p: string) => {
    if (extname(p).toLowerCase() === '.md') schedulePersonasNotification()
  })
  personasWatcher.on('unlink', (p: string) => {
    if (extname(p).toLowerCase() === '.md') schedulePersonasNotification()
  })
  personasWatcher.on('change', (p: string) => {
    if (extname(p).toLowerCase() === '.md') schedulePersonasNotification()
  })
}
