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
import { readFileSync, existsSync } from 'fs'

/**
 * Execute a built-in Bernard tool by name.
 * Built-in tools are implemented directly in the main process (no MCP server, no external JS).
 */
export async function executeBuiltinTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'read':
      return builtinRead(args)
    default:
      return { error: `Unknown built-in tool: "${name}"` }
  }
}

// ── read ─────────────────────────────────────────────────────────────────────

function builtinRead(args: Record<string, unknown>): unknown {
  const filePath = args['file_path']
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { error: 'file_path must be a non-empty string' }
  }

  if (!existsSync(filePath)) {
    return { error: `File not found: ${filePath}` }
  }

  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch (err) {
    return { error: `Failed to read file: ${String(err)}` }
  }

  const lines = raw.split('\n')

  const offset = typeof args['offset'] === 'number' ? Math.max(0, Math.floor(args['offset'])) : 0
  const limit  = typeof args['limit']  === 'number' ? Math.max(1, Math.floor(args['limit']))  : undefined

  const sliced = limit !== undefined ? lines.slice(offset, offset + limit) : lines.slice(offset)

  // Prefix each line with its 1-indexed line number (matching Claude Code's Read output style)
  const numbered = sliced
    .map((line, i) => `${String(offset + i + 1).padStart(6, ' ')}\t${line}`)
    .join('\n')

  return { result: numbered, totalLines: lines.length, offset, linesRead: sliced.length }
}
