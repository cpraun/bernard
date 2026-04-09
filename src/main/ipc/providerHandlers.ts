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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { ipcMain, BrowserWindow } from 'electron'
import { createProvider } from '../providers/ProviderFactory'
import { loadConfig, getToolsDir, getConfigDir } from '../services/ConfigService'
import { getProjectDir } from '../services/ProjectService'
import { InteractionLogger } from '../services/InteractionLogger'
import type { NAIRequest, NAIResponse, ToolDefinition } from '../../shared/types'

let currentAbortController: AbortController | null = null
let currentImproveAbortController: AbortController | null = null

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function showToolApprovalWindow(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  theme?: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const light = theme === 'light'
    const bg = light ? '#ffffff' : '#0f1117'
    const fg = light ? '#111114' : '#e0e0e0'
    const fgSub = light ? '#414149' : '#a1a1aa'
    const bgRaised = light ? '#f4f4f5' : '#1a1b23'
    const border = light ? '#e4e4e7' : '#27272a'
    const accent = light ? '#6366f1' : '#818cf8'
    const accentHover = light ? '#4f46e5' : '#a5b4fc'
    const scrollThumb = light ? '#d4d4d8' : '#3a3a40'
    const scrollThumbHover = light ? '#a1a1aa' : '#4a4a50'

    const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    const argsStr = Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : '(none)'

    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const win = new BrowserWindow({
      width: 620,
      height: 480,
      title: 'Tool Call Result Approval',
      modal: !!parent,
      parent: parent || undefined,
      resizable: true,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    })

    let resolved = false
    const doResolve = (val: boolean): void => {
      if (resolved) return
      resolved = true
      resolve(val)
      if (!win.isDestroyed()) win.close()
    }

    // If user closes the window, treat as decline
    win.on('closed', () => doResolve(false))

    // Listen for the user's choice via page title change
    win.webContents.on('page-title-updated', (_e, title) => {
      if (title === '__approve__') doResolve(true)
      else if (title === '__decline__') doResolve(false)
    })

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tool Call Result Approval</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: ${bg}; color: ${fg}; display: flex; flex-direction: column; height: 100vh; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${scrollThumb}; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: ${scrollThumbHover}; }
  .header { padding: 16px 20px 12px; flex-shrink: 0; }
  .header h2 { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
  .header .sub { font-size: 13px; color: ${fgSub}; }
  .section-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
                   color: ${fgSub}; padding: 0 20px; margin-bottom: 4px; flex-shrink: 0; }
  .args-block { font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace; font-size: 13px;
                line-height: 1.5; padding: 8px 20px; color: ${fgSub}; white-space: pre-wrap;
                word-break: break-word; flex-shrink: 0; max-height: 80px; overflow-y: auto;
                background: ${bgRaised}; border-top: 1px solid ${border}; border-bottom: 1px solid ${border}; }
  .result-label { margin-top: 12px; }
  .result-block { flex: 1; min-height: 0; overflow-y: auto; margin: 4px 0;
                  padding: 8px 20px; font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
                  font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .footer { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 20px;
            border-top: 1px solid ${border}; flex-shrink: 0; }
  .btn { padding: 5px 16px; border-radius: 5px; font-size: 14px; font-weight: 500;
         cursor: pointer; transition: background-color 0.15s, color 0.15s; border: 1px solid ${accent};
         background: transparent; color: ${accent}; }
  .btn:hover { background: ${accent}; color: #fff; }
  .btn-primary { background: ${accent}; color: #fff; border-color: ${accent}; }
  .btn-primary:hover { background: ${accentHover}; border-color: ${accentHover}; }
</style></head><body>
  <div class="header">
    <h2>Send tool result to AI?</h2>
    <div class="sub">Tool: <strong>${escapeHtml(toolName)}</strong></div>
  </div>
  <div class="section-label">Arguments</div>
  <div class="args-block">${escapeHtml(argsStr)}</div>
  <div class="section-label result-label">Result to send to AI</div>
  <div class="result-block">${escapeHtml(resultStr)}</div>
  <div class="footer">
    <button class="btn" onclick="document.title='__decline__'">Decline</button>
    <button class="btn btn-primary" onclick="document.title='__approve__'">Send to AI</button>
  </div>
</body></html>`

    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  })
}

function writeInteractionLog(projectId: string | undefined, messageId: string | undefined, logger: InteractionLogger): void {
  if (!projectId || !messageId) return
  try {
    const projectDir = getProjectDir(projectId)
    const logDir = join(projectDir, '.conversation-logs')
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
    writeFileSync(join(logDir, `${messageId}.log`), logger.toString(), 'utf-8')
  } catch (err) {
    console.error('[providerHandlers] Failed to write interaction log:', err)
  }
}

function loadToolDefinitions(filenames: string[]): ToolDefinition[] {
  const toolsDir = getToolsDir()
  const defs: ToolDefinition[] = []
  for (const filename of filenames) {
    try {
      const filePath = join(toolsDir, filename)
      if (!existsSync(filePath)) continue
      const content = readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(content)
      if (parsed.name) {
        defs.push({ name: parsed.name, description: parsed.description, parameters: parsed.parameters ?? parsed.inputSchema, _mcpServer: parsed._mcpServer })
      }
    } catch (err) {
      console.error(`[providerHandlers] Failed to load tool ${filename}:`, err)
    }
  }
  return defs
}

export function registerProviderHandlers(): void {
  ipcMain.handle('nai:sendMessage', async (_event, request: NAIRequest): Promise<NAIResponse> => {
    const cfg = loadConfig()
    const providerId = request.providerId || cfg.defaultProvider
    const provider = createProvider(providerId)
    const toolDefs = request.selectedTools?.length ? loadToolDefinitions(request.selectedTools) : undefined
    currentAbortController = new AbortController()
    const loggingEnabled = cfg.loggingEnabled !== false
    const logger = loggingEnabled ? new InteractionLogger() : undefined
    logger?.log('REQUEST_START', `provider=${providerId}`)
    const onProgress = (data: import('../providers/NAIProvider').ProgressData): void => {
      const wins = BrowserWindow.getAllWindows()
      if (wins.length > 0) {
        wins[0].webContents.send('nai:progress', data)
      }
    }
    // Build a set of conditional tool names (tools that need user approval before sending results)
    const conditionalToolNames = new Set<string>()
    if (request.conditionalTools?.length) {
      const condDefs = loadToolDefinitions(request.conditionalTools)
      for (const def of condDefs) conditionalToolNames.add(def.name)
    }
    const onToolApproval: import('../providers/NAIProvider').ToolApprovalFn | undefined = conditionalToolNames.size > 0
      ? async (toolName, args, result) => {
          if (!conditionalToolNames.has(toolName)) return true // not conditional → auto-approve
          return showToolApprovalWindow(toolName, args, result, cfg.theme)
        }
      : undefined
    try {
      const response = await provider.sendMessage(request.messages, request.context, toolDefs, currentAbortController.signal, onProgress, logger, onToolApproval)
      logger?.log('REQUEST_END', 'success')
      if (logger) writeInteractionLog(request.projectId, request.messageId, logger)
      return response
    } catch (err) {
      logger?.log('REQUEST_END', `error: ${String(err)}`)
      if (logger) writeInteractionLog(request.projectId, request.messageId, logger)
      throw err
    } finally {
      currentAbortController = null
    }
  })

  ipcMain.on('nai:abort', () => {
    currentAbortController?.abort()
  })

  ipcMain.handle('nai:improveText', async (_event, text: string, promptFile: string): Promise<string> => {
    const cfg = loadConfig()
    // Create provider with temperature=0 and RAG/Gemini file search disabled.
    // No tools, no persona, no commands — only the system prompt file and the user text.
    const provider = createProvider(cfg.defaultProvider, { temperature: 0, ragDisabled: true })
    const promptPath = join(getConfigDir(), promptFile)
    let systemPrompt: string
    if (existsSync(promptPath)) {
      systemPrompt = readFileSync(promptPath, 'utf-8')
    } else {
      systemPrompt = 'You are a writing assistant. Improve the following text for clarity, conciseness, and correctness. Return only the improved text, with no explanation or preamble.'
    }
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: text }
    ]
    currentImproveAbortController = new AbortController()
    try {
      // Pass no tools, no context files, no logger — clean isolated call
      const response = await provider.sendMessage(messages, undefined, undefined, currentImproveAbortController.signal)
      return response.content
    } finally {
      currentImproveAbortController = null
    }
  })

  ipcMain.on('nai:abortImprove', () => {
    currentImproveAbortController?.abort()
  })

  ipcMain.handle('nai:getDefaultProvider', async (): Promise<string> => {
    return loadConfig().defaultProvider
  })
}
