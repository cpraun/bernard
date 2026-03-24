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
import { useEffect, useRef } from 'react'
import type { Message } from '../types/chat'
import MessageBubble from './MessageBubble'

interface MessageListProps {
  messages: Message[]
  onViewLog?: (messageId: string) => void
  messageLogIds?: Set<string>
  activeProjectId?: string | null
}

function MessageList({ messages, onViewLog, messageLogIds, activeProjectId }: MessageListProps): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="message-list">
      {messages.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-title"></div>
          <div className="empty-state-subtitle">Select project and context files, and send a message to get started.</div>
        </div>
      )}
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} onViewLog={onViewLog} hasLog={messageLogIds?.has(msg.id)} activeProjectId={activeProjectId} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

export default MessageList
