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
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { readFileSync, readdirSync, writeFileSync, appendFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join, basename, extname } from 'path'
import { getToolsDir } from './ConfigService'
import type { MCPServerConfig, MCPServerStatus } from '../../shared/types'

interface MCPConnection {
  name: string
  config: MCPServerConfig
  client: Client
  transport: Transport
  tools: string[] // tool names served by this connection
}

const connections = new Map<string, MCPConnection>()

function getLogFilePath(serverName: string): string {
  return join(getToolsDir(), `.mcp-log-${serverName}.log`)
}

function appendLog(serverName: string, message: string): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${message}\n`
  try {
    appendFileSync(getLogFilePath(serverName), line, 'utf-8')
  } catch { /* ignore write errors */ }
}

export function readLogFile(serverName: string): string {
  try {
    return readFileSync(getLogFilePath(serverName), 'utf-8')
  } catch {
    return ''
  }
}

export function deleteLogFile(serverName: string): void {
  const logPath = getLogFilePath(serverName)
  if (existsSync(logPath)) {
    rmSync(logPath, { force: true })
  }
}

/**
 * Check whether a parsed JSON object is an MCP server config.
 * Server configs have a single top-level key whose value is an object with
 * either `command` (stdio) or `url` (HTTP).
 */
export function isServerConfig(obj: unknown): obj is Record<string, MCPServerConfig> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const keys = Object.keys(obj)
  if (keys.length !== 1) return false
  const inner = (obj as Record<string, unknown>)[keys[0]]
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return false
  const val = inner as Record<string, unknown>
  return typeof val.command === 'string' || typeof val.url === 'string'
}

/**
 * Read all MCP server configs from ~/.bernard/tools/.
 * Server config files are JSON files with format: {"server-name": {command/url...}}
 */
function loadServerConfigs(): Map<string, MCPServerConfig> {
  const dir = getToolsDir()
  const configs = new Map<string, MCPServerConfig>()
  let entries: string[]
  try {
    entries = readdirSync(dir)
      .filter((f) => !f.startsWith('.') && extname(f).toLowerCase() === '.json')
  } catch {
    return configs
  }
  for (const filename of entries) {
    try {
      const raw = readFileSync(join(dir, filename), 'utf-8')
      const obj = JSON.parse(raw)
      if (isServerConfig(obj)) {
        const serverName = Object.keys(obj)[0]
        configs.set(serverName, obj[serverName] as MCPServerConfig)
      }
    } catch (err) {
      console.error(`[MCPHostService] Failed to parse ${filename}:`, err)
    }
  }
  return configs
}

/**
 * Initialize MCP servers — called on app startup.
 * If `onlyServers` is provided, only those servers are started.
 * If omitted, all configured servers are started.
 */
export async function initialize(onStatus?: (msg: string) => void, onlyServers?: string[], signal?: AbortSignal): Promise<void> {
  const CONNECTION_TIMEOUT_MS = 15_000
  const configs = loadServerConfigs()
  for (const [name, config] of configs) {
    if (signal?.aborted) {
      console.log('[MCPHostService] Initialization aborted, skipping remaining servers')
      break
    }
    if (onlyServers && !onlyServers.includes(name)) continue
    try {
      onStatus?.(`Connecting MCP server: ${name}...`)
      // Always race against a timeout; optionally also race against the abort signal
      const racers: Promise<never>[] = [
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Connection to "${name}" timed out after ${CONNECTION_TIMEOUT_MS / 1000}s`)), CONNECTION_TIMEOUT_MS)
        })
      ]
      if (signal) {
        racers.push(new Promise<never>((_, reject) => {
          if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'))
          else signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        }))
      }
      await Promise.race([connectServer(name, config), ...racers])
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.log(`[MCPHostService] Connection to "${name}" aborted by user`)
        break
      }
      console.error(`[MCPHostService] Failed to connect server "${name}":`, err)
    }
  }
}

/**
 * Create the appropriate transport based on server config.
 */
function createTransport(name: string, config: MCPServerConfig): Transport {
  // Auto-detect transport: url → HTTP, command → stdio
  if (config.url) {
    console.log(`[MCPHostService] Creating HTTP transport for "${name}": ${config.url}`)

    const requestInit: RequestInit = {}
    if (config.headers && Object.keys(config.headers).length > 0) {
      requestInit.headers = { ...config.headers }
    }

    return new StreamableHTTPClientTransport(
      new URL(config.url),
      Object.keys(requestInit).length > 0 ? { requestInit } : undefined
    )
  }

  // Default: stdio transport
  if (!config.command) {
    throw new Error(`MCP server "${name}" uses stdio transport but no command is configured`)
  }
  console.log(`[MCPHostService] Creating stdio transport for "${name}": ${config.command} ${(config.args ?? []).join(' ')}`)

  return new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
    stderr: 'pipe'
  })
}

/**
 * Connect to a single MCP server and discover its tools.
 */
export async function connectServer(name: string, config: MCPServerConfig): Promise<void> {
  // Disconnect existing connection if any
  if (connections.has(name)) {
    await disconnectServer(name)
  }

  appendLog(name, 'Starting server...')
  const transport = createTransport(name, config)

  const client = new Client({ name: 'bernard', version: '1.0.1' })

  // Handle transport errors/close
  transport.onerror = (error) => {
    console.error(`[MCPHostService] Transport error for "${name}":`, error)
    appendLog(name, `Transport error: ${error.message}`)
  }
  transport.onclose = () => {
    console.log(`[MCPHostService] Transport closed for "${name}"`)
    appendLog(name, 'Transport closed')
    connections.delete(name)
  }

  // Capture stderr from stdio transports
  if (transport instanceof StdioClientTransport) {
    const stderr = (transport as unknown as { stderr: import('stream').Readable | null }).stderr
    if (stderr) {
      stderr.on('data', (chunk: Buffer) => {
        appendLog(name, `[stderr] ${chunk.toString().trimEnd()}`)
      })
    }
  }

  await client.connect(transport)
  appendLog(name, 'Connected successfully')
  console.log(`[MCPHostService] Connected to server "${name}"`)

  const conn: MCPConnection = { name, config, client, transport, tools: [] }
  connections.set(name, conn)

  // Discover tools
  await discoverTools(name)
}

/**
 * Discover tools from a connected MCP server and write them as JSON files.
 */
async function discoverTools(serverName: string): Promise<void> {
  const conn = connections.get(serverName)
  if (!conn) return

  const toolsDir = getToolsDir()
  const serverToolsDir = join(toolsDir, serverName)

  // Clear existing tool files for this server
  if (existsSync(serverToolsDir)) {
    rmSync(serverToolsDir, { recursive: true, force: true })
  }
  mkdirSync(serverToolsDir, { recursive: true })

  try {
    const result = await conn.client.listTools()
    const toolNames: string[] = []

    for (const tool of result.tools) {
      const toolDef = {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        _mcpServer: serverName
      }
      const filename = `${tool.name}.json`
      writeFileSync(join(serverToolsDir, filename), JSON.stringify(toolDef, null, 2), 'utf-8')
      toolNames.push(tool.name)
    }

    conn.tools = toolNames
    console.log(`[MCPHostService] Discovered ${toolNames.length} tools from "${serverName}": ${toolNames.join(', ')}`)
  } catch (err) {
    console.error(`[MCPHostService] Failed to discover tools for "${serverName}":`, err)
    conn.tools = []
  }
}

/**
 * Execute a tool call on an MCP server.
 */
export async function executeTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const conn = connections.get(serverName)
  if (!conn) {
    return { error: `MCP server "${serverName}" is not connected` }
  }

  console.log(`[MCPHostService] Calling tool "${toolName}" on server "${serverName}"`)

  try {
    const result = await conn.client.callTool({ name: toolName, arguments: args })

    // Extract text content from the MCP result
    const textParts = (result.content as { type: string; text?: string }[])
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)

    // If the MCP server flagged this as an error, return as { error: ... }
    if (result.isError) {
      const errorText = textParts.join('\n') || 'Tool returned an error (no details)'
      return { error: errorText }
    }

    if (textParts.length === 0) {
      return { result: 'Tool executed successfully (no text output)' }
    }

    // Try to parse as JSON if it looks like JSON
    const combined = textParts.join('\n')
    try {
      return JSON.parse(combined)
    } catch {
      return { result: combined }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[MCPHostService] Tool call failed:`, err)
    return { error: msg }
  }
}

/**
 * Disconnect a single MCP server and clean up its tool files.
 */
export async function disconnectServer(name: string): Promise<void> {
  const conn = connections.get(name)
  if (conn) {
    appendLog(name, 'Disconnecting server...')
    try {
      await conn.transport.close()
      appendLog(name, 'Server stopped')
    } catch (err) {
      console.error(`[MCPHostService] Error closing transport for "${name}":`, err)
      appendLog(name, `Error stopping server: ${err instanceof Error ? err.message : String(err)}`)
    }
    connections.delete(name)
  }

  // Clean up tool files
  const serverToolsDir = join(getToolsDir(), name)
  if (existsSync(serverToolsDir)) {
    rmSync(serverToolsDir, { recursive: true, force: true })
  }
}

/**
 * Disconnect all MCP servers — called on app quit.
 */
export async function disconnectAll(): Promise<void> {
  const names = Array.from(connections.keys())
  for (const name of names) {
    try {
      const conn = connections.get(name)
      if (conn) {
        await conn.transport.close()
        connections.delete(name)
      }
    } catch (err) {
      console.error(`[MCPHostService] Error disconnecting "${name}":`, err)
    }
  }
}

/**
 * Refresh a single server (disconnect + reconnect + rediscover tools).
 */
export async function refreshServer(name: string): Promise<void> {
  const configs = loadServerConfigs()
  const config = configs.get(name)
  if (!config) {
    await disconnectServer(name)
    return
  }
  await connectServer(name, config)
}

/**
 * Get status for all configured MCP servers.
 */
export function getServerStatuses(): MCPServerStatus[] {
  const configs = loadServerConfigs()
  const statuses: MCPServerStatus[] = []

  for (const [name, config] of configs) {
    const conn = connections.get(name)
    statuses.push({
      name,
      connected: !!conn,
      toolCount: conn?.tools.length ?? 0,
      remote: !!config.url
    })
  }

  return statuses
}
