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
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync, renameSync } from 'fs'
import { join, extname, basename, resolve, sep } from 'path'
import { ipcMain, BrowserWindow } from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'
import { getCommandsDir, getConfigDir } from '../services/ConfigService'

function parseFrontmatter(content: string): { description: string; personas: string[] } {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  let description = ''
  let personas: string[] = []

  if (frontmatterMatch) {
    const block = frontmatterMatch[1]
    const descMatch = block.match(/^description:\s*(.+)$/m)
    if (descMatch) description = descMatch[1].trim()

    const personaMatch = block.match(/^persona:\s*(.+)$/m)
    if (personaMatch) {
      personas = personaMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
    }
  }

  // Fall back description to first non-empty, non-heading, non-frontmatter line
  if (!description) {
    const lines = content.split('\n')
    let inFrontmatter = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === '---') {
        inFrontmatter = !inFrontmatter
        continue
      }
      if (inFrontmatter) continue
      if (trimmed && !trimmed.startsWith('#')) {
        description = trimmed.length > 120 ? trimmed.slice(0, 120) + '\u2026' : trimmed
        break
      }
    }
  }

  return { description, personas }
}

// ── Watcher ───────────────────────────────────────────────────────────────────

let commandsWatcher: FSWatcher | null = null
let commandsDebounceTimer: ReturnType<typeof setTimeout> | null = null

function notifyCommandsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('commands:changed')
  }
}

function scheduleCommandsNotification(): void {
  if (commandsDebounceTimer !== null) clearTimeout(commandsDebounceTimer)
  commandsDebounceTimer = setTimeout(() => {
    commandsDebounceTimer = null
    notifyCommandsChanged()
  }, 200)
}

export function stopCommandsWatcher(): void {
  if (commandsDebounceTimer !== null) {
    clearTimeout(commandsDebounceTimer)
    commandsDebounceTimer = null
  }
  if (commandsWatcher) {
    commandsWatcher.close()
    commandsWatcher = null
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

export function registerCommandsHandlers(): void {
  ipcMain.handle('commands:delete', async (_event, filename: string) => {
    const commandsDir = getCommandsDir()
    const resolved = resolve(join(commandsDir, filename))
    if (!resolved.startsWith(resolve(commandsDir) + sep)) {
      throw new Error('Invalid filename')
    }
    unlinkSync(resolved)
  })

  ipcMain.handle('commands:rename', async (_event, oldFilename: string, newFilename: string) => {
    const commandsDir = getCommandsDir()
    const resolvedOld = resolve(join(commandsDir, oldFilename))
    const resolvedNew = resolve(join(commandsDir, newFilename))
    if (!resolvedOld.startsWith(resolve(commandsDir) + sep)) {
      throw new Error('Invalid filename')
    }
    if (!resolvedNew.startsWith(resolve(commandsDir) + sep)) {
      throw new Error('Invalid filename')
    }
    renameSync(resolvedOld, resolvedNew)
  })

  ipcMain.handle('commands:create', async () => {
    const commandsDir = getCommandsDir()
    let filename = 'new-command.md'
    let counter = 2
    while (existsSync(join(commandsDir, filename))) {
      filename = `new-command-${counter++}.md`
    }
    const templatePath = join(getConfigDir(), 'new-command.md')
    const template = existsSync(templatePath)
      ? readFileSync(templatePath, 'utf-8')
      : `---\ndescription: \n---\n\nType your command template here.\n`
    writeFileSync(join(commandsDir, filename), template, 'utf-8')
    return filename
  })

  ipcMain.handle('commands:save', async (_event, filename: string, content: string) => {
    const commandsDir = getCommandsDir()
    const resolved = resolve(join(commandsDir, filename))
    if (!resolved.startsWith(resolve(commandsDir) + sep)) {
      throw new Error('Invalid filename')
    }
    writeFileSync(resolved, content, 'utf-8')
  })

  ipcMain.handle('commands:list', () => {
    const commandsDir = getCommandsDir()

    let fileNames: string[]
    try {
      const entries = readdirSync(commandsDir, { withFileTypes: true })
      fileNames = entries
        .filter((e) => e.isFile() && extname(String(e.name)).toLowerCase() === '.md')
        .map((e) => String(e.name))
        .sort()
    } catch {
      return []
    }

    return fileNames.map((filename) => {
      try {
        const content = readFileSync(join(commandsDir, filename), 'utf-8')
        const { description, personas } = parseFrontmatter(content)
        return {
          filename,
          name: basename(filename, '.md'),
          content,
          description,
          personas,
          size: content.length
        }
      } catch {
        return null
      }
    }).filter(Boolean)
  })

  // Start watching the commands directory for external file changes
  const commandsDir = getCommandsDir()
  commandsWatcher = chokidar.watch(commandsDir, {
    depth: 0,               // flat — commands are never in subdirectories
    ignoreInitial: true,
    persistent: true,
    ignorePermissionErrors: true
  })
  commandsWatcher.on('add',    (p: string) => { if (extname(p).toLowerCase() === '.md') scheduleCommandsNotification() })
  commandsWatcher.on('unlink', (p: string) => { if (extname(p).toLowerCase() === '.md') scheduleCommandsNotification() })
}
