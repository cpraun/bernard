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
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'

interface ChatInputProps {
  onSend: (text: string) => Promise<boolean | undefined> | void
  disabled?: boolean
  prefill?: string
  onPrefillConsumed?: () => void
  clearSignal?: number
  draftText: string
  onDraftChange: (text: string) => void
  initialInputHeight?: number
}

function ChatInput({ onSend, disabled = false, prefill, onPrefillConsumed, clearSignal, draftText, onDraftChange, initialInputHeight }: ChatInputProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [inputHeight, setInputHeight] = useState(initialInputHeight ?? 40)

  const handleInputResizeStart = useCallback((e: React.MouseEvent): void => {
    const startY = e.clientY
    const startHeight = inputHeight
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
    let lastHeight = startHeight
    const onMove = (ev: MouseEvent): void => {
      lastHeight = Math.max(40, Math.min(400, startHeight - (ev.clientY - startY)))
      setInputHeight(lastHeight)
    }
    const onUp = (): void => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      window.api.patchUIState({ panelSizes: { chatInputHeight: lastHeight } })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [inputHeight])

  useEffect(() => {
    if (prefill) {
      onDraftChange(prefill)
      textareaRef.current?.focus()
      onPrefillConsumed?.()
    }
  }, [prefill, onPrefillConsumed, onDraftChange])

  useEffect(() => {
    if (clearSignal) {
      onDraftChange('')
    }
  }, [clearSignal, onDraftChange])

  const handleSend = async (): Promise<void> => {
    const trimmed = draftText.trim()
    if (!trimmed || disabled) return
    onDraftChange('')
    const result = await onSend(trimmed)
    if (result === false) {
      onDraftChange(trimmed)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      <div className="chat-input-resize-handle" onMouseDown={handleInputResizeStart} />
      <div className="chat-input-container">
        <textarea
          ref={textareaRef}
          className="chat-input"
          style={{ height: inputHeight }}
          placeholder={disabled ? "Press ESC to abort..." : "Type a message..."}
          value={draftText}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
        />
        <button className="send-button" onClick={handleSend} disabled={disabled || !draftText.trim()}>
          Send
        </button>
      </div>
    </>
  )
}

export default ChatInput
