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
import type { ToolExecutionContext } from './ToolExecutionService'

/**
 * Execute a built-in Bernard tool by name.
 * Built-in tools are implemented directly in the main process (no MCP server, no external JS).
 */
export async function executeBuiltinTool(
  name: string,
  args: Record<string, unknown>,
  context?: ToolExecutionContext
): Promise<unknown> {
  switch (name) {
    case 'read':
      return builtinRead(args)
    case 'task':
      return builtinTask(args, context)
    case 'web_fetch':
      return builtinWebFetch(args)
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

// ── web_fetch ─────────────────────────────────────────────────────────────────

async function builtinWebFetch(args: Record<string, unknown>): Promise<unknown> {
  const url = args['url']
  if (typeof url !== 'string' || !url.trim()) {
    return { error: 'url must be a non-empty string' }
  }

  // Validate URL scheme
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return { error: `Invalid URL: ${url}` }
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return { error: `Unsupported URL scheme: ${parsedUrl.protocol} — only http and https are allowed` }
  }

  const maxLength =
    typeof args['max_length'] === 'number'
      ? Math.max(1, Math.floor(args['max_length']))
      : 20_000

  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 Bernard/1.0' },
      signal: AbortSignal.timeout(30_000)
    })
  } catch (err) {
    return { error: `Fetch failed: ${String(err)}` }
  }

  if (!response.ok) {
    return { error: `HTTP ${response.status}: ${response.statusText}` }
  }

  const contentType = response.headers.get('content-type') ?? ''

  let body: string
  try {
    body = await response.text()
  } catch (err) {
    return { error: `Failed to read response body: ${String(err)}` }
  }

  if (contentType.includes('text/html')) {
    body = htmlToText(body)
  }

  if (body.length > maxLength) {
    body = body.slice(0, maxLength) + `\n\n[Content truncated at ${maxLength} characters]`
  }

  return { url, contentType, content: body }
}

/**
 * Convert an HTML string to readable plain text.
 * Removes scripts/styles, collapses tags to whitespace, and decodes entities.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── task ──────────────────────────────────────────────────────────────────────

async function builtinTask(
  args: Record<string, unknown>,
  context?: ToolExecutionContext
): Promise<unknown> {
  const prompt = args['prompt']
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return { error: 'prompt must be a non-empty string' }
  }

  if (!context?.runSubAgent) {
    return { error: 'task tool is not supported by the current provider' }
  }

  const model = typeof args['model'] === 'string' ? args['model'] : undefined

  try {
    const result = await context.runSubAgent(prompt, undefined, model)
    return { result, _note: 'Task completed. Summarise the result for the user. Do NOT call task again.' }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return { error: `Sub-agent failed: ${String(err)}` }
  }
}
