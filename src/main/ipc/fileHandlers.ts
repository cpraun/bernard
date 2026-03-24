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
import { ipcMain, BrowserWindow, shell } from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'
import { parseFile, copyFileToDir, ocrPdfFile, filterEmlHeaders } from '../services/FileParserService'
import { getProjectDir } from '../services/ProjectService'
import { loadConfig } from '../services/ConfigService'
import { loadUIState, patchUIState } from '../services/UIStateService'

const CONTEXT_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.msg', '.eml', '.docx', '.jpg', '.jpeg', '.png'])

let projectFileWatcher: FSWatcher | null = null

function notifyProjectFilesChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('projectFiles:changed')
  }
}

export function watchProjectDir(projectId: string): void {
  if (projectFileWatcher) {
    projectFileWatcher.close()
    projectFileWatcher = null
  }

  const projectDir = getProjectDir(projectId)

  projectFileWatcher = chokidar.watch(projectDir, {
    depth: 0,
    ignoreInitial: true,
    persistent: true,
    ignorePermissionErrors: true
  })

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const onChange = (filePath: string): void => {
    const ext = extname(filePath).toLowerCase()
    if (CONTEXT_EXTENSIONS.has(ext)) {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(notifyProjectFilesChanged, 300)
    }
  }

  projectFileWatcher.on('add', onChange)
  projectFileWatcher.on('unlink', onChange)
  projectFileWatcher.on('change', onChange)
}

function sendStatus(msg: string): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) win.webContents.send('skills:syncStatus', msg)
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildTextViewerHTML(content: string, filename: string, theme?: string): string {
  const light = theme === 'light'
  const bg = light ? '#ffffff' : '#0f1117'
  const fg = light ? '#1a1a1a' : '#e0e0e0'
  const scrollTrack = bg
  const scrollThumb = light ? '#c4c4c8' : '#3a3a40'
  const scrollThumbHover = light ? '#a0a0a4' : '#4a4a50'
  const searchBarBg = light ? '#e8e8ea' : '#25252a'
  const searchBarBorder = light ? '#d4d4d8' : '#3a3a40'
  const searchInputBg = light ? '#ffffff' : '#18181c'
  const searchInputFg = light ? '#1a1a1a' : '#e0e0e0'
  const searchInputBorder = light ? '#c4c4c8' : '#3a3a40'

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(filename)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         margin: 0; padding: 16px; background: ${bg}; color: ${fg}; }
  pre  { white-space: pre-wrap; word-wrap: break-word; font-family: inherit;
         line-height: 1.6; font-size: 14px; margin: 0; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: ${scrollTrack}; }
  ::-webkit-scrollbar-thumb { background: ${scrollThumb}; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: ${scrollThumbHover}; }
</style>
<script>
  window.__themeColors = {
    searchBarBg: '${searchBarBg}',
    searchBarBorder: '${searchBarBorder}',
    searchInputBg: '${searchInputBg}',
    searchInputFg: '${searchInputFg}',
    searchInputBorder: '${searchInputBorder}'
  };
</script>
</head>
<body><pre>${escapeHtml(content)}</pre></body>
</html>`
}

function createPreviewWindow(title: string): BrowserWindow {
  const saved = loadUIState().previewWindowSize
  const win = new BrowserWindow({
    width: saved?.width ?? 800,
    height: saved?.height ?? 600,
    title,
    autoHideMenuBar: true
  })
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  win.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      const bounds = win.getBounds()
      patchUIState({ previewWindowSize: { width: bounds.width, height: bounds.height } })
    }, 500)
  })
  return win
}

function createTextViewerWindow(filename: string, html: string): BrowserWindow {
  const win = createPreviewWindow(filename)

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

  // Inject search bar and wire up findInPage after content loads
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(`
      (function() {
        var bar = null, input = null, info = null, lastQuery = '';

        function showBar() {
          if (bar) { input.focus(); input.select(); return; }
          bar = document.createElement('div');
          var tc = window.__themeColors || {};
          bar.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:8px 12px;background:' + (tc.searchBarBg||'#25252a') + ';border-bottom:1px solid ' + (tc.searchBarBorder||'#3a3a40') + ';z-index:9999;display:flex;align-items:center;gap:8px;';
          input = document.createElement('input');
          input.type = 'text';
          input.placeholder = 'Search…';
          input.style.cssText = 'width:300px;padding:4px 8px;font-size:14px;border:1px solid ' + (tc.searchInputBorder||'#3a3a40') + ';border-radius:4px;outline:none;background:' + (tc.searchInputBg||'#18181c') + ';color:' + (tc.searchInputFg||'#e0e0e0') + ';';
          info = document.createElement('span');
          info.style.cssText = 'color:#8a8a8a;font-size:13px;';
          bar.appendChild(input);
          bar.appendChild(info);
          document.body.style.paddingTop = '44px';
          document.body.insertBefore(bar, document.body.firstChild);

          input.addEventListener('input', function() {
            var q = input.value;
            if (q && q !== lastQuery) { lastQuery = q; console.log('__FIND__:' + q); }
            else if (!q) { lastQuery = ''; console.log('__FINDSTOP__'); info.textContent = ''; }
          });
          input.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') { hideBar(); return; }
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) console.log('__FINDPREV__');
              else console.log('__FINDNEXT__');
            }
          });
          input.focus();
        }

        function hideBar() {
          if (!bar) return;
          bar.remove(); bar = null; input = null; info = null; lastQuery = '';
          document.body.style.paddingTop = '16px';
          console.log('__FINDSTOP__');
        }

        document.addEventListener('keydown', function(e) {
          if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); showBar(); }
        });

        window.__updateFindInfo = function(text) { if (info) info.textContent = text; };
      })();
    `)
  })

  // Bridge console messages to findInPage API
  let currentQuery = ''
  win.webContents.on('console-message', (_event, _level, message) => {
    if (message.startsWith('__FIND__:')) {
      currentQuery = message.slice(9)
      win.webContents.findInPage(currentQuery)
    } else if (message === '__FINDNEXT__' && currentQuery) {
      win.webContents.findInPage(currentQuery, { findNext: true })
    } else if (message === '__FINDPREV__' && currentQuery) {
      win.webContents.findInPage(currentQuery, { findNext: true, forward: false })
    } else if (message === '__FINDSTOP__') {
      currentQuery = ''
      win.webContents.stopFindInPage('clearSelection')
    }
  })

  // Update match count display
  win.webContents.on('found-in-page', (_event, result) => {
    if (result.finalUpdate) {
      const text = result.matches > 0
        ? `${result.activeMatchOrdinal} of ${result.matches}`
        : 'No matches'
      win.webContents.executeJavaScript(`window.__updateFindInfo && window.__updateFindInfo(${JSON.stringify(text)})`)
    }
  })

  return win
}

export function registerFileHandlers(): void {
  ipcMain.handle('file:parse', async (_event, filePath: string) => {
    return parseFile(filePath)
  })

  ipcMain.handle('file:import', async (_event, projectId: string, filePath: string) => {
    const projectDir = getProjectDir(projectId)
    const copiedPath = copyFileToDir(filePath, projectDir)
    // Strip unwanted headers from EML files on disk so preview shows filtered content
    if (extname(copiedPath).toLowerCase() === '.eml') {
      const raw = readFileSync(copiedPath, 'utf-8')
      writeFileSync(copiedPath, filterEmlHeaders(raw), 'utf-8')
    }
    return parseFile(copiedPath)
  })

  ipcMain.handle('file:ocr', async (_event, projectId: string, filename: string) => {
    const projectDir = getProjectDir(projectId)
    const absPath = join(projectDir, filename)
    sendStatus(`Performing OCR for ${filename}…`)
    const content = await ocrPdfFile(absPath, sendStatus)

    // Save OCR text as .txt file with same base name alongside the PDF
    const txtFilename = basename(filename, extname(filename)) + '.txt'
    writeFileSync(join(projectDir, txtFilename), content, 'utf-8')

    sendStatus('OCR complete')
    return { filename: txtFilename, content, contentLength: content.length, type: 'text' as const, size: Buffer.byteLength(content, 'utf-8') }
  })

  ipcMain.handle('file:previewFile', async (_event, projectId: string, filename: string) => {
    const projectDir = getProjectDir(projectId)
    const absPath = join(projectDir, filename)
    const ext = extname(filename).toLowerCase()
    const theme = loadConfig().theme

    if (ext === '.pdf') {
      // Open the PDF in Chromium's built-in PDF viewer
      const win = createPreviewWindow(filename)
      const bg = theme === 'light' ? '#ffffff' : '#1a1a1e'
      const thumbColor = theme === 'light' ? '#c4c4c8' : '#3a3a40'
      const thumbHover = theme === 'light' ? '#a0a0a4' : '#4a4a50'
      win.setBackgroundColor(bg)
      win.webContents.on('did-finish-load', () => {
        win.webContents.insertCSS(`
          body { background: ${bg}; }
          ::-webkit-scrollbar { width: 8px; height: 8px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: transparent; border-radius: 4px; }
          body:hover ::-webkit-scrollbar-thumb { background: ${thumbColor}; }
          body:hover ::-webkit-scrollbar-thumb:hover { background: ${thumbHover}; }
        `)
      })
      win.loadFile(absPath)
    } else if (ext === '.txt' || ext === '.md' || ext === '.eml') {
      const content = readFileSync(absPath, 'utf-8')
      createTextViewerWindow(filename, buildTextViewerHTML(content, filename, theme))
    } else if (ext === '.docx') {
      const parsed = await parseFile(absPath)
      createTextViewerWindow(filename, buildTextViewerHTML(parsed.content, filename, theme))
    } else if (ext === '.msg') {
      const parsed = await parseFile(absPath)
      if (parsed.content.trimStart().startsWith('<!DOCTYPE')) {
        const win = createPreviewWindow(filename)
        win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(parsed.content))
      } else {
        createTextViewerWindow(filename, buildTextViewerHTML(parsed.content, filename, theme))
      }
    } else if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
      const bg = theme === 'light' ? '#ffffff' : '#1a1a1e'
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg'
      const base64 = readFileSync(absPath).toString('base64')
      const win = createPreviewWindow(filename)
      win.setBackgroundColor(bg)
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:${bg}}img{max-width:100%;max-height:100vh;object-fit:contain}</style></head><body><img src="data:${mimeType};base64,${base64}"></body></html>`
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    }
  })

  ipcMain.handle('file:previewHtml', (_event, html: string, title: string) => {
    const win = createPreviewWindow(title)
    const theme = loadConfig().theme
    if (theme === 'light') {
      // For raw HTML previews, inject light scrollbar styles
      const scrollStyle = '<style>::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track{background:#fff}::-webkit-scrollbar-thumb{background:#c4c4c8;border-radius:4px}::-webkit-scrollbar-thumb:hover{background:#a0a0a4}</style>'
      const themed = html.replace(/<\/head>/i, scrollStyle + '</head>')
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(themed))
    } else {
      const scrollStyle = '<style>::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track{background:#18181c}::-webkit-scrollbar-thumb{background:#3a3a40;border-radius:4px}::-webkit-scrollbar-thumb:hover{background:#4a4a50}</style>'
      const themed = html.replace(/<\/head>/i, scrollStyle + '</head>')
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(themed))
    }
  })

  ipcMain.handle('file:watchProject', (_event, projectId: string) => {
    watchProjectDir(projectId)
  })

  ipcMain.handle('file:openProjectDir', (_event, projectId: string) => {
    const projectDir = getProjectDir(projectId)
    shell.openPath(projectDir)
  })

  ipcMain.handle('file:delete', async (_event, projectId: string, filename: string) => {
    const projectDir = getProjectDir(projectId)
    const resolved = resolve(join(projectDir, filename))
    if (!resolved.startsWith(resolve(projectDir) + sep)) throw new Error('Invalid filename')
    unlinkSync(resolved)
  })

  ipcMain.handle('file:listMessageLogs', async (_event, projectId: string) => {
    const logDir = join(getProjectDir(projectId), '.conversation-logs')
    try {
      return readdirSync(logDir)
        .filter((f) => f.endsWith('.log'))
        .map((f) => f.slice(0, -4)) // strip .log to get messageId
    } catch {
      return []
    }
  })

  ipcMain.handle('file:viewMessageLog', async (_event, projectId: string, messageId: string) => {
    const projectDir = getProjectDir(projectId)
    const logPath = join(projectDir, '.conversation-logs', `${messageId}.log`)
    if (!existsSync(logPath)) throw new Error('Log file not found')
    const content = readFileSync(logPath, 'utf-8')
    const theme = loadConfig().theme
    createTextViewerWindow(`Interaction Log`, buildTextViewerHTML(content, `${messageId}.log`, theme))
  })

  ipcMain.handle('file:listProjectFiles', async (_event, projectId: string) => {
    const projectDir = getProjectDir(projectId)
    let fileNames: string[]
    try {
      const entries = readdirSync(projectDir, { withFileTypes: true })
      fileNames = entries
        .filter((e) => e.isFile() && CONTEXT_EXTENSIONS.has(extname(String(e.name)).toLowerCase()))
        .map((e) => String(e.name))
    } catch {
      return []
    }

    const results: Awaited<ReturnType<typeof parseFile>>[] = []
    for (const filename of fileNames) {
      try {
        const parsed = await parseFile(join(projectDir, filename))
        results.push(parsed)
      } catch {
        // skip files that fail to parse
      }
    }
    return results
  })
}
