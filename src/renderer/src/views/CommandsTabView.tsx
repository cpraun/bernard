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

interface Command {
  filename: string
  name: string
  content: string
  description: string
  personas: string[]
  size: number
}

type ViewMode = 'preview' | 'source' | 'edit'

function createTrashDragImage(): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:#ef4444;border-radius:6px;'
  el.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>'
  document.body.appendChild(el)
  return el
}

function CommandsTabView({ initialSidebarWidth, onSidebarResize, onStatusMessage }: { initialSidebarWidth?: number; onSidebarResize?: (width: number) => void; onStatusMessage?: (msg: string | null) => void }): React.JSX.Element {
  const [commands, setCommands] = useState<Command[]>([])
  const [selectedCommand, setSelectedCommand] = useState<Command | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('preview')
  const [editorContent, setEditorContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth ?? 220)
  const dragDropHandled = useRef(false)
  const [renamingFilename, setRenamingFilename] = useState<string | null>(null)
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
      window.api.patchUIState({ panelSizes: { commandsSidebar: lastWidth } })
      onSidebarResize?.(lastWidth)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sidebarWidth, onSidebarResize])

  const loadCommands = useCallback(async (): Promise<void> => {
    const list = await window.api.listCommands()
    setCommands(list)
  }, [])

  useEffect(() => {
    loadCommands()
  }, [loadCommands])

  useEffect(() => {
    return window.api.onCommandsChanged(() => { loadCommands() })
  }, [loadCommands])

  const saveCurrentCommand = useCallback(async (cmd: Command, content: string): Promise<void> => {
    await window.api.saveCommand(cmd.filename, content)
    setSelectedCommand({ ...cmd, content })
    setIsDirty(false)
    await loadCommands()
  }, [loadCommands])

  const handleSelectCommand = async (cmd: Command): Promise<void> => {
    if (selectedCommand?.filename === cmd.filename) {
      if (isDirty) {
        setShowUnsavedDialog(true)
      } else {
        setSelectedCommand(null)
        setEditorContent('')
        setViewMode('preview')
      }
      return
    }
    if (selectedCommand && isDirty) {
      await saveCurrentCommand(selectedCommand, editorContent)
    }
    setSelectedCommand(cmd)
    setEditorContent(cmd.content)
    setIsDirty(false)
    setViewMode('preview')
  }

  const handleDialogSave = async (): Promise<void> => {
    if (selectedCommand) await saveCurrentCommand(selectedCommand, editorContent)
    setSelectedCommand(null)
    setEditorContent('')
    setViewMode('preview')
    setShowUnsavedDialog(false)
  }

  const handleDialogDiscard = (): void => {
    setSelectedCommand(null)
    setEditorContent('')
    setIsDirty(false)
    setViewMode('preview')
    setShowUnsavedDialog(false)
  }

  const handleSave = async (): Promise<void> => {
    if (!selectedCommand || !isDirty) return
    setSaving(true)
    try {
      await saveCurrentCommand(selectedCommand, editorContent)
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
      const improved = await window.api.improveText(input, 'improve-command.md')
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
    if (!selectedCommand) return
    setEditorContent(editorContent || selectedCommand.content)
    setViewMode('edit')
  }

  const handleStartRename = (): void => {
    if (!selectedCommand) return
    setRenamingFilename(selectedCommand.filename)
    setRenameValue(selectedCommand.name)
    setTimeout(() => renameInputRef.current?.focus(), 0)
  }

  const handleConfirmRename = async (): Promise<void> => {
    if (!renamingFilename || !renameValue.trim()) {
      setRenamingFilename(null)
      return
    }
    const newName = renameValue.trim()
    const newFilename = newName.endsWith('.md') ? newName : `${newName}.md`
    if (newFilename === renamingFilename) {
      setRenamingFilename(null)
      return
    }
    await window.api.renameCommand(renamingFilename, newFilename)
    if (selectedCommand?.filename === renamingFilename) {
      const updated = { ...selectedCommand, filename: newFilename, name: newName.replace(/\.md$/i, '') }
      setSelectedCommand(updated)
    }
    setRenamingFilename(null)
    await loadCommands()
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }

  const handleDelete = async (cmd: Command): Promise<void> => {
    await window.api.deleteCommand(cmd.filename)
    if (selectedCommand?.filename === cmd.filename) {
      setSelectedCommand(null)
      setEditorContent('')
      setIsDirty(false)
      setViewMode('preview')
    }
    await loadCommands()
  }

  const isKebabMd = (name: string): boolean =>
    name.endsWith('.md') && /^[a-z0-9]+(-[a-z0-9]+)*\.md$/.test(name)

  const handleDragOver = (e: React.DragEvent<HTMLElement>): void => {
    e.preventDefault()
    if (!e.dataTransfer.types.includes('x-nai-command')) setIsDragOver(true)
  }

  const handleDragLeave = (): void => {
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent<HTMLElement>): Promise<void> => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.types.includes('x-nai-command')) {
      dragDropHandled.current = true
      return
    }
    const valid = Array.from(e.dataTransfer.files).filter((f) => isKebabMd(f.name))
    for (const file of valid) {
      const content = await file.text()
      await window.api.saveCommand(file.name, content)
    }
    if (valid.length > 0) await loadCommands()
  }

  const handleCreateCommand = async (): Promise<void> => {
    const filename = await window.api.createCommand()
    await loadCommands()
    const list = await window.api.listCommands()
    const created = list.find((c) => c.filename === filename)
    if (created) {
      setSelectedCommand(created as Command)
      setEditorContent(created.content)
      setIsDirty(false)
      setViewMode('preview')
      setRenamingFilename(created.filename)
      setRenameValue(created.name)
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
        <div className="personas-sidebar-header">
          <span>Commands</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="project-add-button" onClick={handleCreateCommand} title="New command">+</button>
            <button className="project-add-button" onClick={() => { if (selectedCommand) handleDelete(selectedCommand) }} disabled={!selectedCommand} title="Delete command">&minus;</button>
          </div>
        </div>
        {commands.length === 0 ? (
          <div className="skills-tab-empty">Drop a file of type <span className="context-file-icon file-type-md">MD</span> here to add a Command.</div>
        ) : (
          <div className="skills-tab-tree">
            {commands.map((cmd) => (
              <div
                key={cmd.filename}
                className={`skills-tree-file ${selectedCommand?.filename === cmd.filename ? 'active' : ''}`}
                style={{ paddingLeft: 12, display: 'flex', alignItems: 'center', gap: 6 }}
                draggable
                onClick={() => handleSelectCommand(cmd)}
                onDragStart={(e) => {
                  dragDropHandled.current = false
                  e.dataTransfer.setData('x-nai-command', cmd.filename)
                  e.dataTransfer.effectAllowed = 'move'
                  const img = createTrashDragImage()
                  e.dataTransfer.setDragImage(img, 16, 16)
                  setTimeout(() => document.body.removeChild(img), 0)
                }}
                onDragEnd={async () => {
                  if (!dragDropHandled.current) await handleDelete(cmd)
                }}
              >
                <span className="skills-item-icon file-type-md">MD</span>
                {renamingFilename === cmd.filename ? (
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
                    {cmd.name}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </aside>
      <div className="sidebar-resize-handle" onMouseDown={handleResizeStart} />

      <div
        className="skills-tab-editor"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('x-nai-command')) e.preventDefault()
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('x-nai-command')) return
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
        {selectedCommand ? (
          <>
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
            {viewMode === 'preview' && (
              <div className="personas-markdown">
                <MarkdownPreview content={editorContent || selectedCommand.content} />
              </div>
            )}
            {viewMode === 'source' && (
              <pre className="personas-source">{editorContent || selectedCommand.content}</pre>
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
          <div className="skills-tab-no-selection">Select a command to preview or edit.</div>
        )}
      </div>
    </div>
  )
}

export default CommandsTabView
