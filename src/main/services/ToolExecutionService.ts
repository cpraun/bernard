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
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { getToolsDir } from './ConfigService'
import * as MCPHostService from './MCPHostService'
import { executeBuiltinTool } from './BuiltinToolsService'

/** Sentinel value stored in ToolDefinition._mcpServer for built-in Bernard tools. */
export const BUILTIN_SERVER = '__builtin__'

/**
 * Execution context passed from the calling provider into built-in tool handlers.
 * Allows built-in tools (e.g. task) to call back into the provider without
 * being coupled to a specific provider implementation.
 */
export type ToolExecutionContext = {
  /**
   * Run a sub-agent with the given prompt using the calling provider.
   * @param prompt  Task description for the sub-agent.
   * @param signal  Optional abort signal propagated from the parent call.
   * @param model   Optional model override; falls back to the provider's current model.
   */
  runSubAgent?: (prompt: string, signal?: AbortSignal, model?: string) => Promise<string>
}

/**
 * Centralized tool execution — routes to built-in, MCP server, or local JS implementation.
 */
export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  mcpServer?: string,
  context?: ToolExecutionContext
): Promise<unknown> {
  // Route 0: Built-in Bernard tool
  if (mcpServer === BUILTIN_SERVER) {
    console.log(`[ToolExecution] Routing "${name}" to built-in implementation`)
    return executeBuiltinTool(name, args, context)
  }

  // Route 1: MCP tool — delegate to the MCP server
  if (mcpServer) {
    console.log(`[ToolExecution] Routing "${name}" to MCP server "${mcpServer}"`)
    return MCPHostService.executeTool(mcpServer, name, args)
  }

  // Route 2: Local JS implementation
  // Convert function name to kebab-case filename: camelCase → kebab, snake_case → kebab
  const kebabName = name
    .replace(/([a-z])([A-Z])/g, '$1-$2') // camelCase → camel-Case
    .replace(/_/g, '-')                    // snake_case → snake-case
    .toLowerCase()
  const implFilename = `${kebabName}.js`
  const implPath = join(getToolsDir(), implFilename)

  if (!existsSync(implPath)) {
    const msg = `Implementation file not found: ${implFilename}`
    console.error(`[ToolExecution] ${msg}`)
    return { error: msg }
  }

  console.log(`[ToolExecution] Loading local implementation: ${implPath}`)
  const jsSource = readFileSync(implPath, 'utf-8')

  // Call the function using the exact name from the JSON tool definition
  const wrappedCode = `return (async (args) => { ${jsSource}\n return await ${name}(args); })(args);`
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('args', wrappedCode)
  return await fn(args)
}

/**
 * Check whether a tool call result represents an error.
 * Recognizes both `{ error: ... }` and `{ result: "Error: ..." }` patterns.
 */
export function isToolError(result: unknown): { isError: true; message: string } | { isError: false } {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    if ('error' in r) {
      return { isError: true, message: typeof r.error === 'string' ? r.error : JSON.stringify(r.error) }
    }
    if (typeof r.result === 'string' && /^Error\b/i.test(r.result)) {
      return { isError: true, message: r.result }
    }
  }
  return { isError: false }
}
