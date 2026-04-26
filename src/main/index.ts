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
import { execFileSync } from 'child_process'
import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerProviderHandlers } from './ipc/providerHandlers'
import { registerStorageHandlers } from './ipc/storageHandlers'
import { registerFileHandlers } from './ipc/fileHandlers'
import { registerSettingsHandlers } from './ipc/settingsHandlers'
import { registerSkillsHandlers, stopSkillsWatcher } from './ipc/skillsHandlers'
import { registerCommandsHandlers, stopCommandsWatcher } from './ipc/commandsHandlers'
import { registerAgentsHandlers, stopAgentsWatcher } from './ipc/agentsHandlers'
import { registerToolsHandlers, stopToolsWatcher } from './ipc/toolsHandlers'
import { registerMCPHandlers, stopMCPWatcher } from './ipc/mcpHandlers'
import { registerUIStateHandlers } from './ipc/uiStateHandlers'
import { registerExportHandlers } from './ipc/exportHandlers'
import * as MCPHostService from './services/MCPHostService'
import { initDirectorySync, notifyProjectListChanged, stopWatcher } from './services/DirectoryWatcherService'
import * as GeminiFileSearch from './services/GeminiFileSearchService'
import * as LocalFileSearch from './services/LocalFileSearchService'
import * as FileSearchRouter from './services/FileSearchRouter'
import { loadConfig, getSkillsDir } from './services/ConfigService'
import { loadUIState, patchUIState } from './services/UIStateService'
import { initAppLog, getAppLog, clearAppLog } from './services/AppLogService'

// Capture console output as early as possible
initAppLog()

function createWindow(): void {
  const saved = loadUIState().windowBounds
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: saved?.width ?? 900,
    height: saved?.height ?? 670,
    ...(saved?.x !== undefined && saved?.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    show: false,
    title: ' ',
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (saved?.maximized) mainWindow.maximize()

  // Set dock icon on macOS (needed for dev mode)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon)
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Persist window bounds on resize/move (debounced to avoid excessive writes)
  let boundsTimer: ReturnType<typeof setTimeout> | null = null
  const saveBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (mainWindow.isMaximized()) {
        patchUIState({ windowBounds: { maximized: true } })
      } else {
        const bounds = mainWindow.getBounds()
        patchUIState({ windowBounds: { ...bounds, maximized: false } })
      }
    }, 500)
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)

  // Once the renderer has fully loaded, push the current project list so it
  // is never stale (the initial notifyProjectListChanged from initDirectorySync
  // fires before the renderer has registered its listener).
  mainWindow.webContents.on('did-finish-load', () => {
    notifyProjectListChanged()
  })

  // Prevent dropped files from navigating the window
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register IPC handlers
  registerProviderHandlers()
  registerStorageHandlers()
  registerFileHandlers()
  registerSettingsHandlers()
  registerSkillsHandlers()
  registerCommandsHandlers()
  registerAgentsHandlers()
  registerToolsHandlers()
  registerMCPHandlers()

  // App log IPC
  ipcMain.handle('app:readLog', () => getAppLog())
  ipcMain.handle('app:clearLog', () => { clearAppLog(); return true })
  registerUIStateHandlers()
  registerExportHandlers()

  createWindow()

  // Async initialization with status reporting to splash screen
  const initStatusQueue: string[] = []
  let rendererReady = false

  function sendInitStatus(msg: string): void {
    const wins = BrowserWindow.getAllWindows()
    if (rendererReady && wins.length > 0) {
      wins[0].webContents.send('app:initStatus', msg)
    } else {
      initStatusQueue.push(msg)
    }
  }

  // Flush queued messages once renderer signals it is ready.
  // We wait for an explicit IPC from the renderer (after React mounts
  // its onInitStatus listener) rather than relying on did-finish-load,
  // which fires before React useEffect hooks run.
  ipcMain.once('app:rendererReady', () => {
    rendererReady = true
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      for (const msg of initStatusQueue) {
        win.webContents.send('app:initStatus', msg)
      }
      initStatusQueue.length = 0
    }
  })

  // Run initialization steps sequentially with status updates
  ;(async () => {
    try {
      // Fix PATH for packaged app (inherits user's shell PATH)
      if (process.platform !== 'win32') {
        sendInitStatus('Resolving shell environment...')
        try {
          const shellPath = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'echo -n $PATH'], {
            encoding: 'utf8',
            env: { ...process.env, DISABLE_AUTO_UPDATE: 'true', ZSH_TMUX_AUTOSTART: 'false' }
          }).trim()
          if (shellPath) {
            console.log('[Init] PATH fixed from shell:', shellPath)
            process.env.PATH = shellPath
          }
        } catch (err) {
          console.warn('[Init] Could not read shell PATH:', err)
        }
      }

      sendInitStatus('Scanning projects...')
      initDirectorySync()

      sendInitStatus('Loading settings...')
      const cfg = loadConfig()
      const vectorBackend = cfg.vectorDb?.backend ?? (cfg.vectorDb?.enabled !== false ? 'lancedb' : 'none')

      if (vectorBackend === 'gemini' && cfg.providers['gemini']?.apiKey) {
        sendInitStatus('Initializing Gemini file search...')
        await GeminiFileSearch.initialize(cfg.providers['gemini'].apiKey, getSkillsDir())
      } else if (vectorBackend === 'lancedb') {
        sendInitStatus('Initializing vector store...')
        const embeddingProviderId = cfg.vectorDb?.embeddingProvider ?? 'ollama'
        const provCfg = cfg.providers[embeddingProviderId]
        const isOpenAILocal = embeddingProviderId === 'openai-local'
        const baseUrl = provCfg?.baseUrl || (isOpenAILocal ? 'http://localhost:1234/v1' : 'http://localhost:11434')
        await LocalFileSearch.initialize(baseUrl, getSkillsDir(), undefined, isOpenAILocal)
        LocalFileSearch.setQueryParams(cfg.vectorDb?.ragTopK, cfg.vectorDb?.ragMaxDistance)
      }

      const uiState = loadUIState()
      const runningServers = uiState.runningMCPServers
      const initAbortController = new AbortController()
      const abortHandler = (): void => {
        initAbortController.abort()
        sendInitStatus('Ready')
      }
      ipcMain.on('app:abortInit', abortHandler)
      await MCPHostService.initialize((msg) => sendInitStatus(msg), runningServers, initAbortController.signal)
      ipcMain.removeListener('app:abortInit', abortHandler)

      sendInitStatus('Ready')
    } catch (err) {
      console.error('[Init] Error during initialization:', err)
      sendInitStatus('Ready')
    }
  })()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('will-quit', () => {
  stopWatcher()
  stopSkillsWatcher()
  stopCommandsWatcher()
  stopAgentsWatcher()
  stopToolsWatcher()
  stopMCPWatcher()
  const runningServers = MCPHostService.getServerStatuses()
    .filter((s) => s.connected)
    .map((s) => s.name)
  patchUIState({ runningMCPServers: runningServers })
  MCPHostService.disconnectAll()
  FileSearchRouter.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
