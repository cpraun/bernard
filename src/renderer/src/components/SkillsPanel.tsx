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
import { useEffect, useState } from 'react'

interface Command {
  filename: string
  name: string
  content: string
  description: string
  agents: string[]
  size: number
}

interface CommandsPanelProps {
  isOpen: boolean
  onToggle: () => void
  onAttachCommand: (command: Command) => void
  activeAgentName?: string | null
}

function SkillsPanel({
  isOpen,
  onToggle,
  onAttachCommand,
  activeAgentName
}: CommandsPanelProps): React.JSX.Element {
  const [commands, setCommands] = useState<Command[]>([])

  useEffect(() => {
    window.api.listCommands().then(setCommands)
  }, [])

  useEffect(() => {
    if (isOpen) {
      window.api.listCommands().then(setCommands)
    }
  }, [isOpen])

  // Filter commands by active agent: only show commands whose agent list
  // includes the current agent name. Commands with no agent restriction
  // are always shown. If no agent is active, show all commands.
  const filteredCommands = activeAgentName
    ? commands.filter((cmd) => cmd.agents.length === 0 || cmd.agents.includes(activeAgentName))
    : commands

  return (
    <>
      <button
        className="skills-toggle-button"
        onClick={onToggle}
        title={isOpen ? 'Hide commands' : 'Show commands'}
      >
        {isOpen ? '\u203A' : '\u2039'}
      </button>
      {isOpen && (
        <aside className="skills-panel">
          <div className="skills-header">Commands</div>
          {filteredCommands.length === 0 ? (
            <div className="skills-empty">{commands.length === 0 ? 'No commands — add one in the Commands Tab.' : 'No commands for current agent'}</div>
          ) : (
            <ul className="skills-list">
              {filteredCommands.map((cmd) => (
                  <li key={cmd.filename} className="skills-item">
                    <button
                      className="skills-item-button"
                      onClick={() => onAttachCommand(cmd)}
                      title={`Insert /${cmd.name}`}
                    >
                      <div className="skills-item-header">
                        <span className="skills-item-name">{cmd.name}</span>
                      </div>
                      {cmd.description && (
                        <span className="skills-item-description">{cmd.description}</span>
                      )}
                    </button>
                  </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </>
  )
}

export default SkillsPanel
