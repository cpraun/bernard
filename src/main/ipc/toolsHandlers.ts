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
import { readFileSync, readdirSync, unlinkSync, writeFileSync, renameSync } from 'fs'
import { join, extname, basename, resolve, sep } from 'path'
import { ipcMain, BrowserWindow } from 'electron'
import vm from 'vm'
import chokidar, { type FSWatcher } from 'chokidar'
import { getToolsDir } from '../services/ConfigService'
import { isServerConfig } from '../services/MCPHostService'

// ── Watcher ───────────────────────────────────────────────────────────────────

let toolsWatcher: FSWatcher | null = null
let toolsDebounceTimer: ReturnType<typeof setTimeout> | null = null

function notifyToolsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('tools:changed')
  }
}

function scheduleToolsNotification(): void {
  if (toolsDebounceTimer !== null) clearTimeout(toolsDebounceTimer)
  toolsDebounceTimer = setTimeout(() => {
    toolsDebounceTimer = null
    notifyToolsChanged()
  }, 200)
}

export function stopToolsWatcher(): void {
  if (toolsDebounceTimer !== null) {
    clearTimeout(toolsDebounceTimer)
    toolsDebounceTimer = null
  }
  if (toolsWatcher) {
    toolsWatcher.close()
    toolsWatcher = null
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

export function registerToolsHandlers(): void {
  ipcMain.handle('tools:save', async (_event, filename: string, content: string) => {
    const toolsDir = getToolsDir()
    const resolved = resolve(join(toolsDir, filename))
    if (!resolved.startsWith(resolve(toolsDir) + sep)) {
      throw new Error('Invalid filename')
    }
    writeFileSync(resolved, content, 'utf-8')
  })

  ipcMain.handle('tools:delete', (_event, filename: string) => {
    const toolsDir = getToolsDir()
    const resolved = resolve(join(toolsDir, filename))
    if (!resolved.startsWith(resolve(toolsDir) + sep)) throw new Error('Invalid filename')
    unlinkSync(resolved)
  })

  ipcMain.handle('tools:rename', (_event, oldFilename: string, newFilename: string) => {
    const toolsDir = getToolsDir()
    const resolvedOld = resolve(join(toolsDir, oldFilename))
    const resolvedNew = resolve(join(toolsDir, newFilename))
    if (!resolvedOld.startsWith(resolve(toolsDir) + sep)) throw new Error('Invalid filename')
    if (!resolvedNew.startsWith(resolve(toolsDir) + sep)) throw new Error('Invalid filename')
    renameSync(resolvedOld, resolvedNew)
  })

  ipcMain.handle('tools:list', () => {
    const toolsDir = getToolsDir()
    const allowedExts = ['.json', '.js']
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = []

    // 1. Read top-level files (local tools)
    try {
      const entries = readdirSync(toolsDir, { withFileTypes: true })
      const topFiles = entries
        .filter((e) => e.isFile() && allowedExts.includes(extname(String(e.name)).toLowerCase()))
        .map((e) => String(e.name))
        .sort()

      // First pass: collect JS parse errors by base name
      const jsParseErrors = new Set<string>()
      for (const filename of topFiles) {
        if (extname(filename).toLowerCase() === '.js') {
          try {
            const content = readFileSync(join(toolsDir, filename), 'utf-8')
            new vm.Script(content, { filename })
          } catch {
            jsParseErrors.add(basename(filename, '.js'))
          }
        }
      }

      for (const filename of topFiles) {
        try {
          const ext = extname(filename).toLowerCase()
          const content = readFileSync(join(toolsDir, filename), 'utf-8')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const item: any = {
            filename,
            name: basename(filename, ext),
            content,
            size: content.length
          }
          // Mark JS files that failed to parse
          if (ext === '.js' && jsParseErrors.has(item.name)) {
            item.jsParseError = true
          }
          // Mark JSON files whose corresponding JS file failed to parse
          if (ext === '.json' && jsParseErrors.has(item.name)) {
            item.jsParseError = true
          }
          // Detect MCP server config files
          if (ext === '.json') {
            try {
              const parsed = JSON.parse(content)
              if (isServerConfig(parsed)) {
                item.isMCPConfig = true
                item.name = Object.keys(parsed)[0] // Use server name as display name
              }
            } catch { /* not valid JSON, just show as regular file */ }
          }
          results.push(item)
        } catch { /* skip */ }
      }

      // 2. Read subdirectories (MCP server tools)
      const subdirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => String(e.name))
        .sort()

      for (const dirName of subdirs) {
        try {
          const subEntries = readdirSync(join(toolsDir, dirName), { withFileTypes: true })
          const subFiles = subEntries
            .filter((e) => e.isFile() && extname(String(e.name)).toLowerCase() === '.json')
            .map((e) => String(e.name))
            .sort()

          for (const subFile of subFiles) {
            try {
              const content = readFileSync(join(toolsDir, dirName, subFile), 'utf-8')
              results.push({
                filename: `${dirName}/${subFile}`,
                name: basename(subFile, '.json'),
                content,
                size: content.length,
                serverName: dirName,
                readOnly: true
              })
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }
    } catch {
      return []
    }

    return results
  })

  // Start watching the tools directory for external file changes
  const toolsDir = getToolsDir()
  toolsWatcher = chokidar.watch(toolsDir, {
    depth: 1,
    ignoreInitial: true,
    persistent: true,
    ignorePermissionErrors: true
  })
  const watchedExts = ['.json', '.js']
  toolsWatcher.on('add', (p: string) => {
    if (watchedExts.includes(extname(p).toLowerCase())) scheduleToolsNotification()
  })
  toolsWatcher.on('unlink', (p: string) => {
    if (watchedExts.includes(extname(p).toLowerCase())) scheduleToolsNotification()
  })
  toolsWatcher.on('change', (p: string) => {
    if (watchedExts.includes(extname(p).toLowerCase())) scheduleToolsNotification()
  })
}
