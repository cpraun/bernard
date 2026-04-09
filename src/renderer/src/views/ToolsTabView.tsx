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
import { useCallback, useEffect, useRef, useState } from 'react'

interface ToolFile {
  filename: string
  name: string
  content: string
  size: number
  serverName?: string
  readOnly?: boolean
  isMCPConfig?: boolean
  jsParseError?: boolean
}

type ViewMode = 'preview' | 'edit'

function createTrashDragImage(): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:#ef4444;border-radius:6px;'
  el.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>'
  document.body.appendChild(el)
  return el
}

// ── Syntax highlighting (no deps) ────────────────────────────────────────────

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function highlightJson(code: string): string {
  // Tokenize JSON with a single regex that matches tokens in priority order
  return code.replace(
    /("(?:[^"\\]|\\.)*")\s*(:)|("(?:[^"\\]|\\.)*")|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)|([{}[\]:,])|([^\s"{}[\]:,]+)/g,
    (_m, key, colon, str, num, bool, punc, other) => {
      if (key) return `<span class="tok-key">${esc(key)}</span>${esc(colon)}`
      if (str) return `<span class="tok-str">${esc(str)}</span>`
      if (num) return `<span class="tok-num">${esc(num)}</span>`
      if (bool) return `<span class="tok-bool">${esc(bool)}</span>`
      if (punc) return `<span class="tok-punc">${esc(punc)}</span>`
      if (other) return esc(other)
      return esc(_m)
    }
  )
}

const JS_KW = new Set([
  'function','const','let','var','return','if','else','for','while','do',
  'switch','case','break','continue','async','await','try','catch','finally',
  'throw','new','class','export','import','from','of','in','typeof','instanceof',
  'default','yield','void','delete','this','super'
])

function highlightJs(code: string): string {
  const out: string[] = []
  let i = 0
  while (i < code.length) {
    // Line comment
    if (code[i] === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i)
      const slice = end === -1 ? code.slice(i) : code.slice(i, end)
      out.push(`<span class="tok-cmt">${esc(slice)}</span>`)
      i += slice.length
      continue
    }
    // Block comment
    if (code[i] === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      const slice = end === -1 ? code.slice(i) : code.slice(i, end + 2)
      out.push(`<span class="tok-cmt">${esc(slice)}</span>`)
      i += slice.length
      continue
    }
    // String
    if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const q = code[i]
      let j = i + 1
      while (j < code.length && code[j] !== q) {
        if (code[j] === '\\') j++
        j++
      }
      j++ // closing quote
      out.push(`<span class="tok-str">${esc(code.slice(i, j))}</span>`)
      i = j
      continue
    }
    // Number
    if (/\d/.test(code[i]) || (code[i] === '.' && i + 1 < code.length && /\d/.test(code[i + 1]))) {
      const m = code.slice(i).match(/^[-+]?(?:0[xX][\da-fA-F]+|0[oO][0-7]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/)
      if (m) {
        out.push(`<span class="tok-num">${esc(m[0])}</span>`)
        i += m[0].length
        continue
      }
    }
    // Word (identifier or keyword)
    if (/[a-zA-Z_$]/.test(code[i])) {
      const m = code.slice(i).match(/^[a-zA-Z_$][\w$]*/)!
      const w = m[0]
      if (JS_KW.has(w)) {
        out.push(`<span class="tok-kw">${esc(w)}</span>`)
      } else if (w === 'true' || w === 'false' || w === 'null' || w === 'undefined') {
        out.push(`<span class="tok-bool">${esc(w)}</span>`)
      } else {
        out.push(esc(w))
      }
      i += w.length
      continue
    }
    // Default: emit character escaped
    out.push(esc(code[i]))
    i++
  }
  return out.join('')
}

function highlightCode(code: string, filename: string): string {
  const formatted = filename.endsWith('.json') ? (() => {
    try { return JSON.stringify(JSON.parse(code), null, 2) } catch { return code }
  })() : code
  if (filename.endsWith('.json')) return highlightJson(formatted)
  if (filename.endsWith('.js')) return highlightJs(formatted)
  return esc(formatted)
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  selectedFilenames: Set<string>
  conditionalFilenames: Set<string>
  onSelectionChange: (filenames: Set<string>) => void
  onConditionalChange: (filenames: Set<string>) => void
  initialSidebarWidth?: number
  initialCollapsedMCPServers?: string[]
  onSidebarResize?: (width: number) => void
}

function ToolsTabView({ selectedFilenames, conditionalFilenames, onSelectionChange, onConditionalChange, initialSidebarWidth, initialCollapsedMCPServers, onSidebarResize }: Props): React.JSX.Element {
  const [tools, setTools] = useState<ToolFile[]>([])
  const [viewingFilename, setViewingFilename] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('preview')
  const [editorContent, setEditorContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth ?? 220)
  const dragDropHandled = useRef(false)
  const [renamingFilename, setRenamingFilename] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [collapsedServers, setCollapsedServers] = useState<Set<string>>(
    initialCollapsedMCPServers ? new Set(initialCollapsedMCPServers) : new Set()
  )
  const mcpCollapsedInit = useRef(!!initialCollapsedMCPServers?.length)
  const [logContent, setLogContent] = useState('')
  const [logPanelHeight, setLogPanelHeight] = useState(200)
  const [logPanelVisible, setLogPanelVisible] = useState(true)
  const logEndRef = useRef<HTMLDivElement>(null)
  const [mcpStatuses, setMcpStatuses] = useState<Map<string, boolean>>(new Map()) // server name → connected
  const mcpStatusesRef = useRef(mcpStatuses)
  mcpStatusesRef.current = mcpStatuses
  const [stoppedServers, setStoppedServers] = useState<Set<string>>(new Set()) // intentionally stopped by user

  const handleResizeStart = useCallback((e: React.MouseEvent): void => {
    const startX = e.clientX
    const startWidth = sidebarWidth
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    let lastWidth = startWidth
    const onMove = (ev: MouseEvent): void => {
      lastWidth = Math.max(150, Math.min(450, startWidth + ev.clientX - startX))
      setSidebarWidth(lastWidth)
    }
    const onUp = (): void => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      window.api.patchUIState({ panelSizes: { toolsSidebar: lastWidth } })
      onSidebarResize?.(lastWidth)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sidebarWidth, onSidebarResize])

  const handleLogResizeStart = useCallback((e: React.MouseEvent): void => {
    const startY = e.clientY
    const startHeight = logPanelHeight
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
    let lastHeight = startHeight
    const onMove = (ev: MouseEvent): void => {
      lastHeight = Math.max(80, Math.min(600, startHeight + startY - ev.clientY))
      setLogPanelHeight(lastHeight)
    }
    const onUp = (): void => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [logPanelHeight])

  const loadTools = useCallback(async (): Promise<void> => {
    const list = await window.api.listTools()
    setTools(list as ToolFile[])
    try {
      const statuses = await window.api.getMCPStatuses()
      const map = new Map<string, boolean>()
      for (const s of statuses) {
        map.set(s.name, s.connected)
      }
      // Newly discovered servers that aren't connected should show as stopped (play triangle)
      // rather than disconnected (red X) — they were never attempted, not failed
      setStoppedServers((prev) => {
        const next = new Set(prev)
        for (const s of statuses) {
          if (!mcpStatusesRef.current.has(s.name) && !s.connected) {
            next.add(s.name)
          }
        }
        return next
      })
      setMcpStatuses(map)
    } catch { /* MCP not available */ }
  }, [])

  useEffect(() => {
    loadTools()
    // Initialize stoppedServers from persisted UI state (local servers only)
    window.api.getUIState().then((uiState) => {
      if (uiState.runningMCPServers) {
        const running = new Set(uiState.runningMCPServers)
        window.api.getMCPStatuses().then((statuses) => {
          const stopped = new Set<string>()
          for (const s of statuses) {
            if (!s.connected && !running.has(s.name)) {
              stopped.add(s.name)
            }
          }
          setStoppedServers(stopped)
        }).catch(() => {})
      }
    }).catch(() => {})
  }, [loadTools])

  useEffect(() => {
    return window.api.onToolsChanged(() => {
      loadTools()
    })
  }, [loadTools])

  const viewingTool = tools.find((t) => t.filename === viewingFilename) ?? null
  const viewingServerName = viewingTool?.isMCPConfig
    ? viewingTool.name
    : viewingTool?.serverName ?? null

  // Poll MCP server log when viewing an MCP server
  useEffect(() => {
    if (!viewingServerName) { setLogContent(''); return }
    let active = true
    const poll = async (): Promise<void> => {
      const content = await window.api.readMCPLog(viewingServerName)
      if (active) setLogContent(content)
    }
    poll()
    const interval = setInterval(poll, 1000)
    return () => { active = false; clearInterval(interval) }
  }, [viewingServerName])

  // Auto-scroll log panel to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logContent])

  // Sync editor content when file changes on disk
  useEffect(() => {
    if (viewingTool && !isDirty) {
      setEditorContent(viewingTool.content)
    }
  }, [viewingTool?.content]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveCurrentTool = useCallback(
    async (filename: string, content: string): Promise<void> => {
      await window.api.saveTool(filename, content)
      setIsDirty(false)
      await loadTools()
    },
    [loadTools]
  )

  const guardDirty = (action: () => void): void => {
    if (isDirty) {
      setPendingAction(() => action)
      setShowUnsavedDialog(true)
    } else {
      action()
    }
  }

  const handleClickTool = (tool: ToolFile): void => {
    // Only JSON files are selectable as function tools (not MCP config files, not from disconnected servers, not if JS has parse errors)
    const serverDown = tool.serverName ? mcpStatuses.get(tool.serverName) === false : false
    if (tool.filename.toLowerCase().endsWith('.json') && !tool.isMCPConfig && !serverDown && !tool.jsParseError) {
      const fn = tool.filename
      if (conditionalFilenames.has(fn)) {
        // conditional → unselected
        const nextCond = new Set(conditionalFilenames)
        nextCond.delete(fn)
        onConditionalChange(nextCond)
      } else if (selectedFilenames.has(fn)) {
        // selected → conditional
        const nextSel = new Set(selectedFilenames)
        nextSel.delete(fn)
        onSelectionChange(nextSel)
        const nextCond = new Set(conditionalFilenames)
        nextCond.add(fn)
        onConditionalChange(nextCond)
      } else {
        // unselected → selected
        const nextSel = new Set(selectedFilenames)
        nextSel.add(fn)
        onSelectionChange(nextSel)
      }
    }
    // Also open preview (or close if already viewing)
    if (viewingFilename === tool.filename) {
      guardDirty(() => {
        setViewingFilename(null)
        setEditorContent('')
        setIsDirty(false)
        setViewMode('preview')
      })
      return
    }
    guardDirty(() => {
      setViewingFilename(tool.filename)
      setEditorContent(tool.content)
      setIsDirty(false)
      setViewMode('preview')
    })
  }

  const handleEdit = (): void => {
    if (!viewingTool) return
    setEditorContent(editorContent || viewingTool.content)
    setViewMode('edit')
  }

  const handleStartRename = (): void => {
    if (!viewingTool) return
    setRenamingFilename(viewingTool.filename)
    setRenameValue(viewingTool.name)
    setTimeout(() => renameInputRef.current?.focus(), 0)
  }

  const handleConfirmRename = async (): Promise<void> => {
    if (!renamingFilename || !renameValue.trim()) {
      setRenamingFilename(null)
      return
    }
    const newName = renameValue.trim()
    const newFilename = newName.endsWith('.json') ? newName : `${newName}.json`
    if (newFilename === renamingFilename) {
      setRenamingFilename(null)
      return
    }
    await window.api.renameTool(renamingFilename, newFilename)
    if (viewingFilename === renamingFilename) {
      setViewingFilename(newFilename)
    }
    // Update selection/conditional sets if renamed file was selected
    if (selectedFilenames.has(renamingFilename)) {
      const updated = new Set(selectedFilenames)
      updated.delete(renamingFilename)
      updated.add(newFilename)
      onSelectionChange(updated)
    }
    if (conditionalFilenames.has(renamingFilename)) {
      const updated = new Set(conditionalFilenames)
      updated.delete(renamingFilename)
      updated.add(newFilename)
      onConditionalChange(updated)
    }
    setRenamingFilename(null)
    await loadTools()
  }

  const handleCancelRename = (): void => {
    setRenamingFilename(null)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleConfirmRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelRename()
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!viewingTool || !isDirty) return
    setSaving(true)
    try {
      await saveCurrentTool(viewingTool.filename, editorContent)
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }

  const handleDialogSave = async (): Promise<void> => {
    if (viewingTool) await saveCurrentTool(viewingTool.filename, editorContent)
    setShowUnsavedDialog(false)
    pendingAction?.()
    setPendingAction(null)
  }

  const handleDialogDiscard = (): void => {
    setIsDirty(false)
    setShowUnsavedDialog(false)
    pendingAction?.()
    setPendingAction(null)
  }

  const handleDelete = async (tool: ToolFile): Promise<void> => {
    await window.api.deleteTool(tool.filename)
    if (viewingFilename === tool.filename) {
      setViewingFilename(null)
      setEditorContent('')
      setIsDirty(false)
      setViewMode('preview')
    }
    if (selectedFilenames.has(tool.filename)) {
      const updated = new Set(selectedFilenames)
      updated.delete(tool.filename)
      onSelectionChange(updated)
    }
    if (conditionalFilenames.has(tool.filename)) {
      const updated = new Set(conditionalFilenames)
      updated.delete(tool.filename)
      onConditionalChange(updated)
    }
    await loadTools()
  }

  const handleDeleteMCPServer = async (serverName: string): Promise<void> => {
    await window.api.deleteMCPServer(serverName)
    // Clear editor if viewing config or any tool from this server
    const configFile = tools.find((t) => t.isMCPConfig && t.name === serverName)
    if (
      (configFile && viewingFilename === configFile.filename) ||
      (viewingTool?.serverName === serverName)
    ) {
      setViewingFilename(null)
      setEditorContent('')
      setIsDirty(false)
      setViewMode('preview')
    }
    // Remove any selected/conditional tools from this server
    const serverToolFilenames = tools
      .filter((t) => t.serverName === serverName)
      .map((t) => t.filename)
    if (serverToolFilenames.some((f) => selectedFilenames.has(f))) {
      const updated = new Set(selectedFilenames)
      for (const f of serverToolFilenames) updated.delete(f)
      onSelectionChange(updated)
    }
    if (serverToolFilenames.some((f) => conditionalFilenames.has(f))) {
      const updated = new Set(conditionalFilenames)
      for (const f of serverToolFilenames) updated.delete(f)
      onConditionalChange(updated)
    }
    await loadTools()
  }

  const handleDragOver = (e: React.DragEvent<HTMLElement>): void => {
    e.preventDefault()
    if (!e.dataTransfer.types.includes('x-nai-tool') && !e.dataTransfer.types.includes('x-nai-mcp-server')) setIsDragOver(true)
  }

  const handleDragLeave = (): void => {
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent<HTMLElement>): Promise<void> => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.types.includes('x-nai-tool') || e.dataTransfer.types.includes('x-nai-mcp-server')) {
      dragDropHandled.current = true
      return
    }
    const valid = Array.from(e.dataTransfer.files).filter((f) => f.name.toLowerCase().endsWith('.json') || f.name.toLowerCase().endsWith('.js'))
    for (const file of valid) {
      const content = await file.text()
      await window.api.saveTool(file.name, content)
    }
    if (valid.length > 0) await loadTools()
  }

  const toggleServerCollapse = (serverName: string): void => {
    setCollapsedServers((prev) => {
      const next = new Set(prev)
      if (next.has(serverName)) next.delete(serverName)
      else next.add(serverName)
      window.api.patchUIState({ collapsedMCPServers: [...next] })
      return next
    })
  }

  // Group tools: local tools (excluding MCP configs), then MCP server tools grouped by serverName
  const localTools = tools.filter((t) => !t.serverName && !t.isMCPConfig).sort((a, b) => a.name.localeCompare(b.name))
  const mcpConfigFiles = new Map<string, ToolFile>() // server name → config file
  for (const t of tools) {
    if (t.isMCPConfig) mcpConfigFiles.set(t.name, t)
  }
  const mcpGroupsUnsorted = new Map<string, ToolFile[]>()
  for (const t of tools) {
    if (t.serverName) {
      const group = mcpGroupsUnsorted.get(t.serverName) ?? []
      group.push(t)
      mcpGroupsUnsorted.set(t.serverName, group)
    }
  }
  // Ensure server groups exist even if no tools were discovered yet (config exists but no subdirectory)
  for (const [serverName] of mcpConfigFiles) {
    if (!mcpGroupsUnsorted.has(serverName)) mcpGroupsUnsorted.set(serverName, [])
  }
  // Sort MCP groups alphabetically by server name, and tools within each group
  const mcpGroups = new Map(
    Array.from(mcpGroupsUnsorted.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, group]) => [name, group.sort((a, b) => a.name.localeCompare(b.name))])
  )

  // Collapse all MCP server groups by default on first load (if no saved state)
  if (!mcpCollapsedInit.current && mcpGroups.size > 0) {
    mcpCollapsedInit.current = true
    const allNames = new Set(mcpGroups.keys())
    // Only set if not already matching (avoid infinite re-render)
    if (allNames.size !== collapsedServers.size || [...allNames].some((n) => !collapsedServers.has(n))) {
      setCollapsedServers(allNames)
      window.api.patchUIState({ collapsedMCPServers: [...allNames] })
    }
  }

  const isViewingReadOnly = viewingTool?.readOnly === true

  const renderToolRow = (tool: ToolFile, indent: number): React.JSX.Element => {
    const isLocal = !tool.serverName
    const isDraggable = isLocal && !tool.isMCPConfig
    const isDisconnected = tool.serverName ? mcpStatuses.get(tool.serverName) === false : false
    return (
      <div
        key={tool.filename}
        className={`skills-tree-file ${viewingFilename === tool.filename ? 'active' : ''}`}
        style={{ paddingLeft: indent, display: 'flex', alignItems: 'center', gap: 6, opacity: isDisconnected ? 0.5 : 1 }}
        draggable={isDraggable}
        onClick={() => handleClickTool(tool)}
        onDragStart={isDraggable ? (e) => {
          dragDropHandled.current = false
          e.dataTransfer.setData('x-nai-tool', tool.filename)
          e.dataTransfer.effectAllowed = 'move'
          const img = createTrashDragImage()
          e.dataTransfer.setDragImage(img, 16, 16)
          setTimeout(() => document.body.removeChild(img), 0)
        } : undefined}
        onDragEnd={isDraggable ? async () => {
          if (!dragDropHandled.current) await handleDelete(tool)
        } : undefined}
      >
        {tool.isMCPConfig ? (
          <span className="skills-item-icon file-type-mcp">MCP</span>
        ) : (
          <span className={`skills-item-icon ${tool.filename.endsWith('.js') ? 'file-type-js' : 'file-type-json'}`}>
            {tool.filename.endsWith('.js') ? 'JS' : 'JSON'}
          </span>
        )}
        {renamingFilename === tool.filename ? (
          <input
            ref={renameInputRef}
            className="skills-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleConfirmRename}
            onClick={(e) => e.stopPropagation()}
            spellCheck={false}
          />
        ) : (
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tool.name}
          </span>
        )}
        {isDisconnected || tool.jsParseError ? (
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, marginRight: 8 }}>
            <line x1="2" y1="2" x2="11" y2="11" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
            <line x1="11" y1="2" x2="2" y2="11" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : conditionalFilenames.has(tool.filename) ? (
          <svg width="34" height="14" viewBox="0 0 34 14" fill="none" style={{ flexShrink: 0, marginRight: 8 }}>
            <path d="M7,0.5 L0.5,12.5 L13.5,12.5 Z" fill="#ffffff" stroke="#ef4444" strokeWidth="2.2" strokeLinejoin="round" />
            <polyline points="21.5,7 25,10.5 31.5,3.5" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : selectedFilenames.has(tool.filename) ? (
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, marginRight: 8 }}>
            <polyline points="1.5,6.5 5,10 11.5,3" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </div>
    )
  }

  return (
    <div className="skills-tab">
      <aside
        className={`skills-tab-sidebar${isDragOver ? ' drag-over' : ''}`}
        style={{ width: sidebarWidth }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {tools.length === 0 ? (
          <div className="skills-tab-empty">Drop a file of type <span className="context-file-icon file-type-js">JS</span>{' or '}<span className="context-file-icon file-type-json">JSON</span>{' '} here to add a local tools and local/remote MCP servers.</div>
        ) : (
          <div className="skills-tab-tree">
            {/* Local tools */}
            {localTools.map((tool) => renderToolRow(tool, 12))}

            {/* MCP server groups */}
            {Array.from(mcpGroups.entries()).map(([serverName, serverTools]) => {
              const isCollapsed = collapsedServers.has(serverName)
              const configFile = mcpConfigFiles.get(serverName)
              const isActive = configFile && viewingFilename === configFile.filename
              const serverStopped = stoppedServers.has(serverName)
              const serverDisconnected = !serverStopped && mcpStatuses.get(serverName) === false
              return (
                <div key={`mcp-${serverName}`}>
                  <div
                    className={`skills-tree-file mcp-server-header ${isActive ? 'active' : ''}`}
                    style={{ paddingLeft: 8, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                    draggable
                    onClick={() => {
                      // Click on header opens the config file for viewing/editing
                      if (configFile) handleClickTool(configFile)
                    }}
                    onDragStart={(e) => {
                      dragDropHandled.current = false
                      e.dataTransfer.setData('x-nai-mcp-server', serverName)
                      e.dataTransfer.effectAllowed = 'move'
                      const img = createTrashDragImage()
                      e.dataTransfer.setDragImage(img, 16, 16)
                      setTimeout(() => document.body.removeChild(img), 0)
                    }}
                    onDragEnd={async () => {
                      if (!dragDropHandled.current) await handleDeleteMCPServer(serverName)
                    }}
                  >
                    <svg
                      width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
                      style={{ flexShrink: 0, transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 0.15s' }}
                      onClick={(e) => { e.stopPropagation(); toggleServerCollapse(serverName) }}
                    >
                      <polygon points="2,1 8,5 2,9" />
                    </svg>
                    <span className="skills-item-icon file-type-mcp">MCP</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, opacity: 0.85 }}>
                      {serverName}
                    </span>
                    <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>{serverTools.length}</span>
                    {serverDisconnected ? (
                      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" style={{ flexShrink: 0, marginRight: 8 }}>
                        <line x1="3" y1="3" x2="14" y2="14" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
                        <line x1="14" y1="3" x2="3" y2="14" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : mcpStatuses.has(serverName) && !serverStopped ? (
                      <svg
                        width="17" height="17" viewBox="0 0 17 17" fill="none"
                        style={{ flexShrink: 0, marginRight: 8, cursor: 'pointer' }}
                        onContextMenu={async (e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          await window.api.stopMCPServer(serverName)
                          setStoppedServers((prev) => { const next = new Set(prev); next.add(serverName); return next })
                          const statuses = await window.api.getMCPStatuses()
                          const running = statuses.filter((s) => s.connected).map((s) => s.name)
                          window.api.patchUIState({ runningMCPServers: running })
                          await loadTools()
                        }}
                      >
                        <path d="M12,3 C15,3 16,6 16,8.5 C16,12 13.5,15 11.5,15 M11.5,15 L11.5,17 M6,8.5 C6,6.5 7.5,5 9,5 C10.5,5 11.5,6.5 11.5,8 C11.5,10 10,11 9,12" stroke="var(--ev-c-text-3)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                      </svg>
                    ) : (
                      <svg
                        width="17" height="17" viewBox="0 0 17 17" fill="none"
                        style={{ flexShrink: 0, marginRight: 8, cursor: 'pointer' }}
                        onContextMenu={async (e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setStoppedServers((prev) => { const next = new Set(prev); next.delete(serverName); return next })
                          try {
                            await Promise.race([
                              window.api.refreshMCPServer(serverName),
                              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
                            ])
                            const statuses = await window.api.getMCPStatuses()
                            const map = new Map<string, boolean>()
                            for (const s of statuses) map.set(s.name, s.connected)
                            setMcpStatuses(map)
                            const running = statuses.filter((s) => s.connected).map((s) => s.name)
                            window.api.patchUIState({ runningMCPServers: running })
                          } catch {
                            setMcpStatuses((prev) => { const next = new Map(prev); next.set(serverName, false); return next })
                          }
                          await loadTools()
                        }}
                      >
                        <polygon points="3,1 3,16 15,8.5" fill="var(--ev-c-text-3)" />
                      </svg>
                    )}
                  </div>
                  {!isCollapsed && serverTools.map((tool) => renderToolRow(tool, 24))}
                </div>
              )
            })}
          </div>
        )}
      </aside>
      <div className="sidebar-resize-handle" onMouseDown={handleResizeStart} />

      <div
        className="skills-tab-editor"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('x-nai-tool') || e.dataTransfer.types.includes('x-nai-mcp-server')) e.preventDefault()
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('x-nai-tool') && !e.dataTransfer.types.includes('x-nai-mcp-server')) return
          e.preventDefault()
          dragDropHandled.current = true
        }}
      >
        {showUnsavedDialog && (
          <div className="unsaved-dialog-overlay">
            <div className="unsaved-dialog">
              <div className="unsaved-dialog-message">This file has unsaved changes.</div>
              <div className="unsaved-dialog-actions">
                <button className="unsaved-dialog-save" onClick={handleDialogSave}>Save</button>
                <button className="unsaved-dialog-discard" onClick={handleDialogDiscard}>Discard</button>
              </div>
            </div>
          </div>
        )}

        {viewingTool ? (
          <>
            <div className="skills-tab-editor-toolbar">
              {isDirty && <span className="skills-tab-dirty-dot" title="Unsaved changes" />}
              {!isViewingReadOnly && (
                <>
                  <button className="skills-tab-save-button" onClick={handleStartRename}>
                    Rename
                  </button>
                  <button className="skills-tab-save-button" onClick={viewMode === 'edit' ? () => setViewMode('preview') : handleEdit}>
                    {viewMode === 'edit' ? 'Close' : 'Edit'}
                  </button>
                  <button
                    className="skills-tab-save-button"
                    onClick={handleSave}
                    disabled={!isDirty || saving}
                  >
                    {saving ? 'Saving\u2026' : 'Save'}
                  </button>
                </>
              )}
              {isViewingReadOnly && (
                <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>MCP tool (read-only)</span>
              )}
            </div>

            {viewMode === 'preview' && (
              <div className="agents-markdown">
                <pre
                  className="agents-source"
                  dangerouslySetInnerHTML={{ __html: highlightCode(editorContent || viewingTool.content, viewingTool.filename) }}
                />
              </div>
            )}
            {viewMode === 'edit' && !isViewingReadOnly && (
              <div className="editor-wrap">
                <textarea
                  className="skills-tab-textarea"
                  value={editorContent}
                  onChange={(e) => { setEditorContent(e.target.value); setIsDirty(true) }}
                  onKeyDown={handleKeyDown}
                  spellCheck={false}
                />
                <pre
                  className="editor-ws-overlay"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{
                    __html: esc(editorContent)
                      .replace(/\t/g, '<span class="ws-tab">\u2192</span>\t')
                      .replace(/^( +)/gm, (m) => m.replace(/ /g, '<span class="ws-sp">\u00b7</span>'))
                  }}
                />
              </div>
            )}
          </>
        ) : (
          <div className="skills-tab-no-selection">Select a tool to preview or edit.</div>
        )}

        {viewingServerName && (
          <>
            <div className="mcp-log-resize-handle" onMouseDown={handleLogResizeStart} />
            <div className="mcp-log-panel" style={{ height: logPanelVisible ? logPanelHeight : 28 }}>
              <div
                className="mcp-log-header"
                onClick={() => setLogPanelVisible(!logPanelVisible)}
              >
                <span>Server Log: {viewingServerName}</span>
                <span style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className="test-button"
                    style={{ fontSize: '0.7rem', padding: '1px 8px' }}
                    onClick={(e) => { e.stopPropagation(); window.api.clearMCPLog(viewingServerName!).then(() => setLogContent('')) }}
                  >
                    Clear
                  </button>
                  <span className="mcp-log-toggle">{logPanelVisible ? '\u25BC' : '\u25B2'}</span>
                </span>
              </div>
              {logPanelVisible && (
                <pre className="mcp-log-content">
                  {logContent || '(no log output)'}
                  <div ref={logEndRef} />
                </pre>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default ToolsTabView
