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
import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { Message } from '../types/chat'

interface MessageBubbleProps {
  message: Message
  onViewLog?: (messageId: string) => void
  hasLog?: boolean
  activeProjectId?: string | null
}

function CopyIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CopyTextIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  )
}

function EyeIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function LogIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  )
}

function WordIcon(): React.JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <text x="12" y="21" textAnchor="middle" fill="currentColor" fontSize="28" fontWeight="bold" fontFamily="'Times New Roman', 'Georgia', serif">W</text>
    </svg>
  )
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function markdownToPlainText(md: string): string {
  return md
    .replace(/\$\$([\s\S]*?)\$\$/g, '$1')            // display math $$...$$ → content
    .replace(/\$([^$]+)\$/g, '$1')                    // inline math $...$ → content
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '$1')   // fenced code blocks → content
    .replace(/`([^`]+)`/g, '$1')                   // inline code → content
    .replace(/^#{1,6}\s+/gm, '')                   // headings
    .replace(/\*\*([^*]+)\*\*/g, '$1')             // bold **
    .replace(/\*([^*]+)\*/g, '$1')                 // italic *
    .replace(/__([^_]+)__/g, '$1')                 // bold __
    .replace(/_([^_]+)_/g, '$1')                   // italic _
    .replace(/~~([^~]+)~~/g, '$1')                 // strikethrough
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')      // images → alt text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')       // links → label
    .replace(/^>\s+/gm, '')                        // blockquotes
    .replace(/^[-*]\s+/gm, '• ')                   // unordered lists → bullet
    .replace(/^---+$/gm, '')                       // horizontal rules
    .trim()
}

function createChatDragImage(): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:#818cf8;border-radius:6px;pointer-events:none;z-index:9999;'
  el.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h4"/></svg>'
  document.body.appendChild(el)
  return el
}

/** Global right-drag state accessible from App.tsx drop targets */
;(window as any).__naiDragContent = null

function MessageBubble({ message, onViewLog, hasLog, activeProjectId }: MessageBubbleProps): React.JSX.Element {
  const isUser = message.role === 'user'
  const htmlTagPattern = /^<(!DOCTYPE|html|head|body|div|table|ul|ol|p|h[1-6]|section|article|nav|form|span|pre|style)/i
  const fencedHtmlPattern = /^```html\s*\n([\s\S]*?)```\s*$/
  const rawContent = message.content.trimStart()
  const fencedMatch = !isUser ? rawContent.match(fencedHtmlPattern) : null
  const isHtml = !isUser && (htmlTagPattern.test(rawContent) || (fencedMatch !== null && htmlTagPattern.test(fencedMatch[1].trimStart())))
  const [copiedMd, setCopiedMd] = useState(false)
  const [copiedText, setCopiedText] = useState(false)

  const handleCopyMarkdown = (): void => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopiedMd(true)
      setTimeout(() => setCopiedMd(false), 1500)
    })
  }

  const handlePreviewHtml = (): void => {
    const title = 'HTML Preview — ' + new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const html = fencedMatch ? fencedMatch[1] : message.content
    window.api.previewHtml(html, title)
  }

  const handleCopyText = (): void => {
    navigator.clipboard.writeText(markdownToPlainText(message.content)).then(() => {
      setCopiedText(true)
      setTimeout(() => setCopiedText(false), 1500)
    })
  }

  const handleExportDocx = (): void => {
    if (activeProjectId) {
      window.api.exportMessageToDocx(activeProjectId, message.content)
    }
  }

  const handleRightDrag = (e: React.MouseEvent): void => {
    if (e.button !== 2) return
    const startX = e.clientX
    const startY = e.clientY
    let dragging = false
    let dragImg: HTMLElement | null = null

    const onMouseMove = (ev: MouseEvent): void => {
      if (!dragging) {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        if (dx * dx + dy * dy < 25) return
        dragging = true
        ;(window as any).__naiDragContent = message.content
        dragImg = createChatDragImage()
      }
      if (dragImg) {
        dragImg.style.top = `${ev.clientY - 16}px`
        dragImg.style.left = `${ev.clientX - 16}px`
      }
    }

    const onMouseUp = (): void => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      if (dragImg?.parentNode) document.body.removeChild(dragImg)
      if (dragging) {
        document.addEventListener('contextmenu', (ev) => ev.preventDefault(), { once: true })
      }
      ;(window as any).__naiDragContent = null
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  return (
    <div className={`message-row ${isUser ? 'message-row-user' : 'message-row-assistant'}`}>
      <div
        className={`message-bubble ${isUser ? 'bubble-user' : message.isError ? 'bubble-error' : 'bubble-assistant'}${message.isPending ? ' bubble-pending' : ''}`}
        onMouseDown={!isUser ? handleRightDrag : undefined}
        onContextMenu={!isUser ? (e) => { if ((window as any).__naiDragContent) e.preventDefault() } : undefined}
      >
        {message.isPending ? (
          <div className="message-content bubble-pending-content">
            <div className="bubble-pending-indicator" />
          </div>
        ) : (
          <div className="message-content">
            {isUser ? message.content : <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{message.content}</Markdown>}
          </div>
        )}
        {isUser && message.contextFiles && message.contextFiles.length > 0 && (
          <div className="message-sources">
            <span className="message-sources-label">Context used:</span>
            <div className="message-sources-chips">
              {message.contextFiles.map((name) => (
                <span key={name} className="message-source-chip">
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="message-sources">
            <span className="message-sources-label">Skills used:</span>
            <div className="message-sources-chips">
              {message.sources.map((src) => (
                <span key={src.title} className="message-source-chip" title={src.text}>
                  {src.title}
                </span>
              ))}
            </div>
          </div>
        )}
        {!isUser && message.toolsUsed && message.toolsUsed.length > 0 && (
          <div className="message-sources">
            <span className="message-sources-label">Tools used:</span>
            <div className="message-sources-chips">
              {message.toolsUsed.map((tool, idx) => (
                <span key={idx} className={`message-source-chip message-tool-chip ${tool.error ? 'message-tool-chip-error' : 'message-tool-chip-success'}`} title={tool.args ? JSON.stringify(tool.args, null, 2) : undefined}>
                  {tool.name}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="message-footer">
          {message.isPending ? (
            <span className="message-time">
              {(message.responseTimeMs! / 1000).toFixed(1)}s
            </span>
          ) : (
            <>
              <span className="message-time">
                {new Date(message.timestamp).toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric'
                })}{' '}
                {new Date(message.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true
                })}
              </span>
              {isUser && message.promptTokens !== undefined && (
                <span className="message-time">– {message.promptTokens} tokens sent</span>
              )}
              {!isUser && message.completionTokens !== undefined && (
                <span className="message-time">– {message.completionTokens} tokens received</span>
              )}
              {!isUser && message.responseTimeMs !== undefined && (
                <span className="message-time">– {(message.responseTimeMs / 1000).toFixed(1)}s</span>
              )}
              {isHtml && (
                <button className="message-copy-button" onClick={handlePreviewHtml} title="Preview HTML">
                  <EyeIcon />
                </button>
              )}
              <button
                className={`message-copy-button ${copiedText ? 'message-copy-button-copied' : ''}`}
                onClick={handleCopyText}
                title="Copy as plain text"
              >
                {copiedText ? <CheckIcon /> : <CopyIcon />}
              </button>
              {!isUser && activeProjectId && (
                <button className="message-copy-button" onClick={handleExportDocx} title="Export as Word">
                  <WordIcon />
                </button>
              )}
              {!isUser && onViewLog && hasLog && (
                <button className="message-copy-button" onClick={() => onViewLog(message.id)} title="View interaction log">
                  <LogIcon />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default MessageBubble
