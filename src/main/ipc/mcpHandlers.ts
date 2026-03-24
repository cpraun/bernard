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
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'fs'
import { join, extname, basename, resolve, sep } from 'path'
import { ipcMain } from 'electron'
import { getToolsDir } from '../services/ConfigService'
import * as MCPHostService from '../services/MCPHostService'
import { isServerConfig } from '../services/MCPHostService'
import type { MCPServerConfig } from '../../shared/types'

// No dedicated MCP watcher — the tools watcher (toolsHandlers.ts) already
// watches the tools directory at depth 1.  Changes to server config files
// are picked up via tools:changed, and MCP reconnection is triggered by
// explicit mcp:refreshServer / mcp:refreshAll calls.

export function stopMCPWatcher(): void {
  // no-op — kept for backwards-compat with index.ts lifecycle call
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

export function registerMCPHandlers(): void {
  /**
   * List MCP server configs found in the tools directory.
   * Server config files have format: {"server-name": {command/url...}}
   */
  ipcMain.handle('mcp:listServers', () => {
    const dir = getToolsDir()
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      const results: { name: string; filename: string; config: MCPServerConfig }[] = []

      for (const entry of entries) {
        if (!entry.isFile() || String(entry.name).startsWith('.') || extname(String(entry.name)).toLowerCase() !== '.json') continue
        const filename = String(entry.name)
        try {
          const content = readFileSync(join(dir, filename), 'utf-8')
          const obj = JSON.parse(content)
          if (isServerConfig(obj)) {
            const serverName = Object.keys(obj)[0]
            results.push({
              name: serverName,
              filename,
              config: obj[serverName] as MCPServerConfig
            })
          }
        } catch { /* skip */ }
      }
      return results
    } catch {
      return []
    }
  })

  /**
   * Save an MCP server config. Writes {"serverName": config} to <serverName>.json
   * in the tools directory.
   */
  ipcMain.handle('mcp:saveServer', async (_event, name: string, configJson: string) => {
    const dir = getToolsDir()
    const filename = `${name}.json`
    const resolved = resolve(join(dir, filename))
    if (!resolved.startsWith(resolve(dir) + sep)) {
      throw new Error('Invalid server name')
    }

    // Parse the inner config, wrap with server name as key
    const config = JSON.parse(configJson) as MCPServerConfig
    const wrapped = { [name]: config }
    writeFileSync(resolved, JSON.stringify(wrapped, null, 2), 'utf-8')

    // Auto-refresh the server connection after saving
    try {
      await MCPHostService.refreshServer(name)
    } catch (err) {
      console.error(`[mcpHandlers] Failed to refresh server "${name}" after save:`, err)
    }
  })

  ipcMain.handle('mcp:deleteServer', async (_event, name: string) => {
    const dir = getToolsDir()
    // Find the file containing this server config
    try {
      const entries = readdirSync(dir)
        .filter((f) => !f.startsWith('.') && extname(f).toLowerCase() === '.json')

      for (const filename of entries) {
        try {
          const content = readFileSync(join(dir, filename), 'utf-8')
          const obj = JSON.parse(content)
          if (isServerConfig(obj) && Object.keys(obj)[0] === name) {
            const resolved = resolve(join(dir, filename))
            if (resolved.startsWith(resolve(dir) + sep)) {
              unlinkSync(resolved)
            }
            break
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
    await MCPHostService.disconnectServer(name)
    MCPHostService.deleteLogFile(name)
  })

  ipcMain.handle('mcp:readLog', (_event, name: string) => {
    return MCPHostService.readLogFile(name)
  })

  ipcMain.handle('mcp:clearLog', (_event, name: string) => {
    MCPHostService.deleteLogFile(name)
  })

  ipcMain.handle('mcp:getStatuses', () => {
    return MCPHostService.getServerStatuses()
  })

  ipcMain.handle('mcp:refreshServer', async (_event, name: string) => {
    await MCPHostService.refreshServer(name)
  })

  ipcMain.handle('mcp:stopServer', async (_event, name: string) => {
    await MCPHostService.disconnectServer(name)
  })

  ipcMain.handle('mcp:refreshAll', async () => {
    await MCPHostService.initialize()
  })
}
