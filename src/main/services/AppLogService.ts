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

const MAX_LINES = 2000
const logLines: string[] = []

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '')
}

export function initAppLog(): void {
  const origLog = console.log.bind(console)
  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)

  console.log = (...args: unknown[]) => {
    origLog(...args)
    appendLine('LOG', args)
  }

  console.error = (...args: unknown[]) => {
    origError(...args)
    appendLine('ERR', args)
  }

  console.warn = (...args: unknown[]) => {
    origWarn(...args)
    appendLine('WRN', args)
  }
}

function appendLine(level: string, args: unknown[]): void {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  logLines.push(`[${timestamp()}] [${level}] ${msg}`)
  if (logLines.length > MAX_LINES) {
    logLines.splice(0, logLines.length - MAX_LINES)
  }
}

export function getAppLog(): string {
  return logLines.join('\n')
}

export function clearAppLog(): void {
  logLines.length = 0
}
