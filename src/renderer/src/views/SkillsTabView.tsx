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
import MarkdownPreview from '../components/MarkdownPreview'

type SkillFile = { kind: 'file'; name: string; path: string; content: string; size: number }
type SkillDir  = { kind: 'dir';  name: string; path: string; children: SkillTreeNode[] }
type SkillTreeNode = SkillFile | SkillDir

type ViewMode = 'preview' | 'source' | 'edit'

function getFileTypeLabel(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'pdf': return 'PDF'
    case 'docx': return 'DOCX'
    case 'msg': return 'MSG'
    case 'txt': return 'TXT'
    default: return 'MD'
  }
}

function createTrashDragImage(): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:#ef4444;border-radius:6px;'
  el.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>'
  document.body.appendChild(el)
  return el
}

function TreeItem({ node, depth, selectedPath, onSelect, onDragStart, onDragEnd, renamingPath, renameValue, onRenameChange, onRenameKeyDown, onRenameBlur, renameInputRef, collapsedDirs, onToggleDir }: {
  node: SkillTreeNode
  depth: number
  selectedPath: string | null
  onSelect: (f: SkillFile) => void
  onDragStart: (f: SkillFile, e: React.DragEvent) => void
  onDragEnd: (f: SkillFile) => void
  renamingPath: string | null
  renameValue: string
  onRenameChange: (v: string) => void
  onRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onRenameBlur: () => void
  renameInputRef: React.RefObject<HTMLInputElement | null>
  collapsedDirs: Set<string>
  onToggleDir: (path: string) => void
}): React.JSX.Element {
  const indent = depth * 14

  if (node.kind === 'file') {
    return (
      <div
        className={`skills-tree-file ${node.path === selectedPath ? 'active' : ''}`}
        style={{ paddingLeft: 12 + indent, display: 'flex', alignItems: 'center', gap: 6 }}
        draggable
        onClick={() => onSelect(node)}
        onDragStart={(e) => onDragStart(node, e)}
        onDragEnd={() => onDragEnd(node)}
      >
        <span className={`skills-item-icon file-type-${getFileTypeLabel(node.name).toLowerCase()}`}>{getFileTypeLabel(node.name)}</span>
        {renamingPath === node.path ? (
          <input
            ref={renameInputRef}
            className="skills-rename-input"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={onRenameKeyDown}
            onBlur={onRenameBlur}
            onClick={(e) => e.stopPropagation()}
            spellCheck={false}
          />
        ) : (
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.name.replace(/\.(md|pdf|docx|msg|txt)$/i, '')}
          </span>
        )}
      </div>
    )
  }

  const expanded = !collapsedDirs.has(node.path)

  return (
    <div>
      <div
        className="skills-tree-dir"
        style={{ paddingLeft: 8 + indent }}
        onClick={() => onToggleDir(node.path)}
      >
        <span className={`skills-tree-chevron ${expanded ? 'open' : ''}`}>›</span>
        {node.name}
      </div>
      {expanded &&
        node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            renamingPath={renamingPath}
            renameValue={renameValue}
            onRenameChange={onRenameChange}
            onRenameKeyDown={onRenameKeyDown}
            onRenameBlur={onRenameBlur}
            renameInputRef={renameInputRef}
            collapsedDirs={collapsedDirs}
            onToggleDir={onToggleDir}
          />
        ))}
    </div>
  )
}

function SkillsTabView({ initialSidebarWidth, initialCollapsedSkillDirs, onSidebarResize, onStatusMessage }: { initialSidebarWidth?: number; initialCollapsedSkillDirs?: string[]; onSidebarResize?: (width: number) => void; onStatusMessage?: (msg: string | null) => void }): React.JSX.Element {
  const [tree, setTree] = useState<SkillTreeNode[]>([])
  const [selectedFile, setSelectedFile] = useState<SkillFile | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('preview')
  const [editorContent, setEditorContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isListing, setIsListing] = useState(false)
  const [storeFiles, setStoreFiles] = useState<string[] | null>(null)
  const [purging, setPurging] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [hasVectorDb, setHasVectorDb] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth ?? 220)
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(
    initialCollapsedSkillDirs ? new Set(initialCollapsedSkillDirs) : new Set()
  )
  const dragDropHandled = useRef(false)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [improving, setImproving] = useState(false)

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
      window.api.patchUIState({ panelSizes: { skillsSidebar: lastWidth } })
      onSidebarResize?.(lastWidth)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sidebarWidth, onSidebarResize])

  const toggleSkillDir = useCallback((path: string): void => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      window.api.patchUIState({ collapsedSkillDirs: [...next] })
      return next
    })
  }, [])

  const loadTree = useCallback(async (): Promise<void> => {
    const nodes = await window.api.listSkills()
    setTree(nodes as SkillTreeNode[])
  }, [])

  useEffect(() => {
    loadTree()
    window.api.getSettings().then((s) => {
      const backend = s.vectorDb?.backend ?? (s.vectorDb?.enabled !== false ? 'lancedb' : 'none')
      setHasVectorDb(backend !== 'none')
    })
  }, [loadTree])

  useEffect(() => {
    return window.api.onSkillsChanged(() => { loadTree() })
  }, [loadTree])

  const saveCurrentFile = useCallback(async (file: SkillFile, content: string): Promise<void> => {
    await window.api.saveSkill(file.path, content)
    setSelectedFile({ ...file, content })
    setIsDirty(false)
    await loadTree()
  }, [loadTree])

  const handleSelectFile = async (file: SkillFile): Promise<void> => {
    if (selectedFile?.path === file.path) {
      if (isDirty) {
        setShowUnsavedDialog(true)
      } else {
        setSelectedFile(null)
        setEditorContent('')
        setViewMode('preview')
      }
      return
    }
    if (selectedFile && isDirty) {
      await saveCurrentFile(selectedFile, editorContent)
    }
    setSelectedFile(file)
    setEditorContent(file.content)
    setIsDirty(false)
    const ext = file.name.split('.').pop()?.toLowerCase()
    setViewMode(ext === 'pdf' || ext === 'docx' ? 'source' : 'preview')
  }

  const handleDialogSave = async (): Promise<void> => {
    if (selectedFile) await saveCurrentFile(selectedFile, editorContent)
    setSelectedFile(null)
    setEditorContent('')
    setViewMode('preview')
    setShowUnsavedDialog(false)
  }

  const handleDialogDiscard = (): void => {
    setSelectedFile(null)
    setEditorContent('')
    setIsDirty(false)
    setViewMode('preview')
    setShowUnsavedDialog(false)
  }

  const handleSave = async (): Promise<void> => {
    if (!selectedFile || !isDirty) return
    setSaving(true)
    try {
      await saveCurrentFile(selectedFile, editorContent)
    } finally {
      setSaving(false)
    }
  }


  const handleImprove = async (): Promise<void> => {
    const ta = textareaRef.current
    const selectedText = ta && ta.selectionStart !== ta.selectionEnd
      ? ta.value.substring(ta.selectionStart, ta.selectionEnd)
      : null
    const input = selectedText ?? editorContent
    if (!input.trim()) return
    setImproving(true)
    onStatusMessage?.('Improving text with AI… (ESC to cancel)')
    try {
      const improved = await window.api.improveText(input, 'improve-skill.md')
      if (selectedText && ta) {
        const before = editorContent.substring(0, ta.selectionStart)
        const after = editorContent.substring(ta.selectionEnd)
        setEditorContent(before + improved + after)
      } else {
        setEditorContent(improved)
      }
      setIsDirty(true)
      onStatusMessage?.(null)
    } catch {
      onStatusMessage?.('Improvement cancelled')
      setTimeout(() => onStatusMessage?.(null), 2000)
    } finally {
      setImproving(false)
    }
  }

  useEffect(() => {
    if (!improving) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.api.abortImprove()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [improving])

  const handleEdit = (): void => {
    if (!selectedFile) return
    setEditorContent(editorContent || selectedFile.content)
    setViewMode('edit')
  }

  const handleStartRename = (): void => {
    if (!selectedFile) return
    setRenamingPath(selectedFile.path)
    setRenameValue(selectedFile.name.replace(/\.(md|pdf|docx|msg|txt)$/i, ''))
    setTimeout(() => renameInputRef.current?.focus(), 0)
  }

  const handleConfirmRename = async (): Promise<void> => {
    if (!renamingPath || !renameValue.trim()) {
      setRenamingPath(null)
      return
    }
    const oldPath = renamingPath
    const dir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/') + 1) : ''
    const oldExt = oldPath.split('.').pop() ?? 'md'
    const newName = renameValue.trim()
    const newFilename = /\.\w+$/.test(newName) ? newName : `${newName}.${oldExt}`
    const newPath = dir + newFilename
    if (newPath === oldPath) {
      setRenamingPath(null)
      return
    }
    await window.api.renameSkill(oldPath, newPath)
    if (selectedFile?.path === oldPath) {
      setSelectedFile({ ...selectedFile, path: newPath, name: newFilename })
    }
    setRenamingPath(null)
    await loadTree()
  }

  const handleCancelRename = (): void => {
    setRenamingPath(null)
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

  const handleSync = async (): Promise<void> => {
    setIsSyncing(true)
    try {
      await window.api.syncSkillsFileStore()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setIsSyncing(false)
    }
  }

  const handleListStore = async (): Promise<void> => {
    if (storeFiles !== null) {
      setStoreFiles(null)
      return
    }
    setIsListing(true)
    try {
      const files = await window.api.listSkillsFileStore()
      setStoreFiles(files)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'List failed')
    } finally {
      setIsListing(false)
    }
  }

  const handlePurgeStore = async (): Promise<void> => {
    if (!window.confirm('Delete all documents from the Vector Store? This cannot be undone.')) return
    setPurging(true)
    try {
      await window.api.purgeSkillsFileStore()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Purge failed')
    } finally {
      setPurging(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }

  const handleDelete = async (file: SkillFile): Promise<void> => {
    await window.api.deleteSkill(file.path)
    if (selectedFile?.path === file.path) {
      setSelectedFile(null)
      setEditorContent('')
      setIsDirty(false)
      setViewMode('preview')
    }
    await loadTree()
  }

  const handleDragOver = (e: React.DragEvent<HTMLElement>): void => {
    e.preventDefault()
    if (!e.dataTransfer.types.includes('x-nai-skill')) setIsDragOver(true)
  }

  const handleDragLeave = (): void => {
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent<HTMLElement>): Promise<void> => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.types.includes('x-nai-skill')) {
      dragDropHandled.current = true
      return
    }
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    const paths = files.map((f) => window.api.getFilePath(f))
    await window.api.importSkillPaths(paths)
    await loadTree()
  }

  const handleTreeItemDragStart = (file: SkillFile, e: React.DragEvent): void => {
    dragDropHandled.current = false
    e.dataTransfer.setData('x-nai-skill', file.path)
    e.dataTransfer.effectAllowed = 'move'
    const img = createTrashDragImage()
    e.dataTransfer.setDragImage(img, 16, 16)
    setTimeout(() => document.body.removeChild(img), 0)
  }

  const handleTreeItemDragEnd = async (file: SkillFile): Promise<void> => {
    if (!dragDropHandled.current) await handleDelete(file)
  }

  const handleCreateSkill = async (): Promise<void> => {
    const filename = await window.api.createSkill()
    await loadTree()
    const nodes = await window.api.listSkills() as SkillTreeNode[]
    const findFile = (items: SkillTreeNode[]): SkillFile | null => {
      for (const n of items) {
        if (n.kind === 'file' && n.name === filename) return n
        if (n.kind === 'dir') {
          const found = findFile(n.children)
          if (found) return found
        }
      }
      return null
    }
    const created = findFile(nodes)
    if (created) {
      setSelectedFile(created)
      setEditorContent(created.content)
      setIsDirty(false)
      setViewMode('preview')
      setRenamingPath(created.path)
      setRenameValue(created.name.replace(/\.(md|pdf|docx|msg|txt)$/i, ''))
      setTimeout(() => renameInputRef.current?.focus(), 0)
    }
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
        <div className="agents-sidebar-header">
          <span>Skills</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="project-add-button" onClick={handleCreateSkill} title="New skill">+</button>
            <button className="project-add-button" onClick={() => { if (selectedFile) handleDelete(selectedFile) }} disabled={!selectedFile} title="Delete skill">&minus;</button>
          </div>
        </div>
        {tree.length === 0 ? (
          <div className="skills-tab-empty">Drop a file of type <span className="context-file-icon file-type-md">MD</span> <span className="context-file-icon file-type-pdf">PDF</span> <span className="context-file-icon file-type-docx">DOCX</span> <span className="context-file-icon file-type-txt">TXT</span> here to add a skill.</div>
        ) : (
          <div className="skills-tab-tree">
            {tree.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                depth={0}
                selectedPath={selectedFile?.path ?? null}
                onSelect={handleSelectFile}
                onDragStart={handleTreeItemDragStart}
                onDragEnd={handleTreeItemDragEnd}
                renamingPath={renamingPath}
                renameValue={renameValue}
                onRenameChange={setRenameValue}
                onRenameKeyDown={handleRenameKeyDown}
                onRenameBlur={handleConfirmRename}
                renameInputRef={renameInputRef}
                collapsedDirs={collapsedDirs}
                onToggleDir={toggleSkillDir}
              />
            ))}
          </div>
        )}
      </aside>
      <div className="sidebar-resize-handle" onMouseDown={handleResizeStart} />

      <div
        className="skills-tab-editor"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('x-nai-skill')) e.preventDefault()
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('x-nai-skill')) return
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
        {selectedFile ? (
          <>
            {!selectedFile.name.endsWith('.pdf') && !selectedFile.name.endsWith('.docx') && !selectedFile.name.toLowerCase().endsWith('.msg') ? (
              <div className="skills-tab-editor-toolbar">
                {isDirty && <span className="skills-tab-dirty-dot" title="Unsaved changes" />}
                <button className="skills-tab-save-button" onClick={handleStartRename}>
                  Rename
                </button>
                <button
                  className="skills-tab-save-button"
                  onClick={handleImprove}
                  disabled={improving || viewMode !== 'edit'}
                  title="Improve text with AI"
                >
                  {improving ? 'Improving…' : 'Improve'}
                </button>
                <button className="skills-tab-save-button" onClick={viewMode === 'edit' ? () => setViewMode('preview') : handleEdit}>
                  {viewMode === 'edit' ? 'Close' : 'Edit'}
                </button>
                <button
                  className="skills-tab-save-button"
                  onClick={handleSave}
                  disabled={!isDirty || saving}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            ) : (
              <div className="skills-tab-editor-toolbar">
                <button className="skills-tab-save-button" onClick={handleStartRename}>
                  Rename
                </button>
              </div>
            )}
            {viewMode === 'preview' && (
              <div className="agents-markdown">
                {selectedFile.name.toLowerCase().endsWith('.msg') && (editorContent || selectedFile.content).trimStart().startsWith('<!DOCTYPE') ? (
                  <iframe
                    srcDoc={editorContent || selectedFile.content}
                    sandbox=""
                    style={{ width: '100%', height: '100%', border: 'none' }}
                    title={selectedFile.name}
                  />
                ) : (
                  <MarkdownPreview content={editorContent || selectedFile.content} />
                )}
              </div>
            )}
            {viewMode === 'source' && (
              <pre className="agents-source">{editorContent || selectedFile.content}</pre>
            )}
            {viewMode === 'edit' && (
              <textarea
                ref={textareaRef}
                className="skills-tab-textarea"
                value={editorContent}
                onChange={(e) => { setEditorContent(e.target.value); setIsDirty(true) }}
                onKeyDown={handleKeyDown}
                spellCheck={false}
              />
            )}
          </>
        ) : (
          <>
            <div className="skills-tab-editor-toolbar">
                <button
                  className="skills-tab-save-button"
                  onClick={handleSync}
                  disabled={isSyncing || !hasVectorDb}
                  title={!hasVectorDb ? 'No vector database configured' : undefined}
                >
                  {isSyncing ? 'Syncing…' : 'Sync'}
                </button>
                <button
                  className="skills-tab-save-button"
                  onClick={handleListStore}
                  disabled={isListing || !hasVectorDb}
                  title={!hasVectorDb ? 'No vector database configured' : undefined}
                >
                  {isListing ? 'Loading…' : storeFiles !== null ? 'Hide' : 'List'}
                </button>
                <button
                  className="skills-tab-save-button skills-purge-button"
                  onClick={handlePurgeStore}
                  disabled={purging || !hasVectorDb}
                  title={!hasVectorDb ? 'No vector database configured' : undefined}
                >
                  {purging ? 'Purging…' : 'Purge'}
                </button>
            </div>
            {storeFiles !== null ? (
              <div className="skills-store-file-list">
                {storeFiles.length === 0 ? (
                  <span className="skills-store-file-empty">No files in store</span>
                ) : (
                  storeFiles.map((f) => (
                    <div key={f} className="skills-store-file-entry">{f}</div>
                  ))
                )}
              </div>
            ) : (
              <div className="skills-tab-no-selection">
                <div>Select a skill to preview or edit.</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default SkillsTabView
