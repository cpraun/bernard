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
import { useRef } from 'react'

interface ContextFile {
  filename: string
  content: string
  type: 'text' | 'md' | 'pdf' | 'msg' | 'eml' | 'docx' | 'jpg' | 'png'
  size: number
  contentLength: number
  mediaType?: string
  selected: boolean
}

interface ContextPanelProps {
  files: ContextFile[]
  onRemove: (index: number) => void
  onToggle: (index: number) => void
  onDrop: (filePaths: string[]) => void
  onPreviewFile: (filename: string) => void
  onOcrFile: (index: number) => void
  dragHandledRef: React.MutableRefObject<boolean>
}

function createTrashDragImage(): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:#ef4444;border-radius:6px;'
  el.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>'
  document.body.appendChild(el)
  return el
}

function ContextPanel({ files, onRemove, onToggle, onDrop, onPreviewFile, onOcrFile, dragHandledRef }: ContextPanelProps): React.JSX.Element {
  const dragImageRef = useRef<HTMLElement | null>(null)

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('x-nai-context-file')) {
      dragHandledRef.current = true
      return
    }
    const droppedFiles = Array.from(e.dataTransfer.files)
    const paths = droppedFiles
      .map((f) => window.api.getFilePath(f))
      .filter(Boolean)
    if (paths.length > 0) {
      onDrop(paths)
    }
  }

  if (files.length === 0) {
    return (
      <div className="context-panel empty" onDragOver={handleDragOver} onDrop={handleDrop}>
        <div className="context-drop-hint">
          Drop files of type{' '}
          <span className="context-file-icon file-type-docx">DOCX</span>{' '}
          <span className="context-file-icon file-type-eml">EML</span>{' '}
          <span className="context-file-icon file-type-md">MD</span>{' '}
          <span className="context-file-icon file-type-msg">MSG</span>{' '}
          <span className="context-file-icon file-type-pdf">PDF</span>{' '}
          <span className="context-file-icon file-type-txt">TXT</span>{' '}
          <span className="context-file-icon file-type-jpg">JPG</span>{' '}
          <span className="context-file-icon file-type-png">PNG</span>{' '}
          here to add context.
        </div>
      </div>
    )
  }

  const selectedCount = files.filter((f) => f.selected).length

  return (
    <div className="context-panel" onDragOver={handleDragOver} onDrop={handleDrop}>
      <div className="context-header">
        <span>Context Files ({selectedCount}/{files.length} selected)</span>
      </div>
      <ul className="context-file-list">
        {files.map((file, index) => (
          <li
            key={`${file.filename}-${index}`}
            className={`context-file-item ${file.selected ? '' : 'unselected'}`}
            draggable
            onDragStart={(e) => {
              dragHandledRef.current = false
              e.dataTransfer.setData('x-nai-context-file', String(index))
              e.dataTransfer.effectAllowed = 'move'
              const img = createTrashDragImage()
              dragImageRef.current = img
              e.dataTransfer.setDragImage(img, 16, 16)
            }}
            onDragEnd={() => {
              if (dragImageRef.current) {
                document.body.removeChild(dragImageRef.current)
                dragImageRef.current = null
              }
              if (!dragHandledRef.current) onRemove(index)
            }}
            onClick={() => onToggle(index)}
          >
            <span className="context-file-check" style={{ width: 13, flexShrink: 0 }}>
              {file.selected && (
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <polyline points="1.5,6.5 5,10 11.5,3" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className={`context-file-icon file-type-${file.type}`}>{file.type === 'text' ? 'TXT' : file.type.toUpperCase()}</span>
            <span className="context-file-name">{file.filename}</span>
            <span className="context-file-size" title={file.mediaType ? `File: ${file.size > 1024 ? `${(file.size / 1024).toFixed(1)}KB` : `${file.size}B`}` : `File: ${file.size > 1024 ? `${(file.size / 1024).toFixed(1)}KB` : `${file.size}B`} / Content: ${file.contentLength > 1024 ? `${(file.contentLength / 1024).toFixed(1)}K` : file.contentLength} chars`}>
              {file.size > 1024 ? `${(file.size / 1024).toFixed(1)}KB` : `${file.size}B`}{file.mediaType ? '' : ` / ${file.contentLength > 1024 ? `${(file.contentLength / 1024).toFixed(1)}K` : file.contentLength}c`}
            </span>
            {file.type === 'pdf' ? (
              <button
                className="context-file-preview"
                title="Run OCR on this PDF"
                onClick={(e) => { e.stopPropagation(); onOcrFile(index) }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="7" y1="8" x2="17" y2="8" />
                  <line x1="7" y1="12" x2="17" y2="12" />
                  <line x1="7" y1="16" x2="13" y2="16" />
                </svg>
              </button>
            ) : (
              <span className="context-file-preview" style={{ visibility: 'hidden' }}>
                <svg width="14" height="14" />
              </span>
            )}
            {(file.type === 'pdf' || file.type === 'text' || file.type === 'md' || file.type === 'eml' || file.type === 'docx' || file.type === 'msg' || file.type === 'jpg' || file.type === 'png') && (
              <button
                className="context-file-preview"
                title="Preview file"
                onClick={(e) => { e.stopPropagation(); onPreviewFile(file.filename) }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ContextPanel
export type { ContextFile }
