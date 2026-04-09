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

interface Persona {
  filename: string
  name: string
  content: string
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

interface Props {
  activeFilename: string | null
  onSelect: (filename: string | null, content: string | null) => void
  initialSidebarWidth?: number
  onSidebarResize?: (width: number) => void
  onStatusMessage?: (msg: string | null) => void
}

function PersonasTabView({ activeFilename, onSelect, initialSidebarWidth, onSidebarResize, onStatusMessage }: Props): React.JSX.Element {
  const [personas, setPersonas] = useState<Persona[]>([])
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
      window.api.patchUIState({ panelSizes: { personasSidebar: lastWidth } })
      onSidebarResize?.(lastWidth)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sidebarWidth, onSidebarResize])

  const loadPersonas = useCallback(async (): Promise<void> => {
    const list = await window.api.listPersonas()
    setPersonas(list as Persona[])
  }, [])

  useEffect(() => {
    loadPersonas()
  }, [loadPersonas])

  useEffect(() => {
    return window.api.onPersonasChanged(() => {
      loadPersonas()
    })
  }, [loadPersonas])

  const selectedPersona = personas.find((p) => p.filename === activeFilename) ?? null

  // When the selected file changes externally (e.g. disk reload), sync editor content
  useEffect(() => {
    if (selectedPersona && !isDirty) {
      setEditorContent(selectedPersona.content)
    }
  }, [selectedPersona?.content]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveCurrentPersona = useCallback(
    async (filename: string, content: string): Promise<void> => {
      await window.api.savePersona(filename, content)
      onSelect(filename, content) // update active persona content in App.tsx
      setIsDirty(false)
      await loadPersonas()
    },
    [loadPersonas, onSelect]
  )

  const guardDirty = (action: () => void): void => {
    if (isDirty) {
      setPendingAction(() => action)
      setShowUnsavedDialog(true)
    } else {
      action()
    }
  }

  const handleSelectPersona = (persona: Persona): void => {
    if (activeFilename === persona.filename) {
      guardDirty(() => {
        onSelect(null, null)
        setEditorContent('')
        setIsDirty(false)
        setViewMode('preview')
      })
      return
    }
    guardDirty(() => {
      onSelect(persona.filename, persona.content)
      setEditorContent(persona.content)
      setIsDirty(false)
    })
  }


  const handleEdit = (): void => {
    if (!selectedPersona) return
    setEditorContent(editorContent || selectedPersona.content)
    setViewMode('edit')
  }

  const handleStartRename = (): void => {
    if (!selectedPersona) return
    setRenamingFilename(selectedPersona.filename)
    setRenameValue(selectedPersona.name)
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
    await window.api.renamePersona(renamingFilename, newFilename)
    if (activeFilename === renamingFilename) {
      const content = selectedPersona?.content ?? ''
      onSelect(newFilename, content)
    }
    setRenamingFilename(null)
    await loadPersonas()
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
    if (!selectedPersona || !isDirty) return
    setSaving(true)
    try {
      await saveCurrentPersona(selectedPersona.filename, editorContent)
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
      const improved = await window.api.improveText(input, 'improve-persona.md')
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }

  const handleDialogSave = async (): Promise<void> => {
    if (selectedPersona) await saveCurrentPersona(selectedPersona.filename, editorContent)
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

  const handleDelete = async (persona: Persona): Promise<void> => {
    await window.api.deletePersona(persona.filename)
    if (activeFilename === persona.filename) {
      onSelect(null, null)
      setEditorContent('')
      setIsDirty(false)
      setViewMode('preview')
    }
    await loadPersonas()
  }

  const isKebabMd = (name: string): boolean =>
    name.endsWith('.md') && /^[a-z0-9]+(-[a-z0-9]+)*\.md$/.test(name)

  const handleDragOver = (e: React.DragEvent<HTMLElement>): void => {
    e.preventDefault()
    if (!e.dataTransfer.types.includes('x-nai-persona')) setIsDragOver(true)
  }

  const handleDragLeave = (): void => {
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent<HTMLElement>): Promise<void> => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.types.includes('x-nai-persona')) {
      dragDropHandled.current = true
      return
    }
    const valid = Array.from(e.dataTransfer.files).filter((f) => isKebabMd(f.name))
    for (const file of valid) {
      const content = await file.text()
      await window.api.savePersona(file.name, content)
    }
    if (valid.length > 0) await loadPersonas()
  }

  const handleCreatePersona = async (): Promise<void> => {
    const filename = await window.api.createPersona()
    await loadPersonas()
    const list = await window.api.listPersonas() as Persona[]
    const created = list.find((p) => p.filename === filename)
    if (created) {
      onSelect(created.filename, created.content)
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
          <span>Personas</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="project-add-button" onClick={handleCreatePersona} title="New persona">+</button>
            <button className="project-add-button" onClick={() => { if (selectedPersona) handleDelete(selectedPersona) }} disabled={!selectedPersona} title="Delete persona">&minus;</button>
          </div>
        </div>
        {personas.length === 0 ? (
          <div className="skills-tab-empty">Drop a file of type <span className="context-file-icon file-type-md">MD</span> here to add a persona.</div>
        ) : (
          <div className="skills-tab-tree">
            {personas.map((persona) => (
              <div
                key={persona.filename}
                className={`skills-tree-file ${activeFilename === persona.filename ? 'active' : ''}`}
                style={{ paddingLeft: 12, display: 'flex', alignItems: 'center', gap: 6 }}
                draggable
                onClick={() => handleSelectPersona(persona)}
                onDragStart={(e) => {
                  dragDropHandled.current = false
                  e.dataTransfer.setData('x-nai-persona', persona.filename)
                  e.dataTransfer.effectAllowed = 'move'
                  const img = createTrashDragImage()
                  e.dataTransfer.setDragImage(img, 16, 16)
                  setTimeout(() => document.body.removeChild(img), 0)
                }}
                onDragEnd={async () => {
                  if (!dragDropHandled.current) await handleDelete(persona)
                }}
              >
                <span className="skills-item-icon file-type-md">MD</span>
                {renamingFilename === persona.filename ? (
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
                    {persona.name}
                  </span>
                )}
                {activeFilename === persona.filename && (
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, marginRight: 8 }}>
                    <polyline points="1.5,6.5 5,10 11.5,3" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
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
          if (e.dataTransfer.types.includes('x-nai-persona')) e.preventDefault()
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('x-nai-persona')) return
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

        {selectedPersona ? (
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
                <MarkdownPreview content={editorContent || selectedPersona.content} />
              </div>
            )}
            {viewMode === 'source' && (
              <pre className="personas-source">{editorContent || selectedPersona.content}</pre>
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
          <div className="skills-tab-no-selection">Select a persona to preview or edit.</div>
        )}
      </div>
    </div>
  )
}

export default PersonasTabView
