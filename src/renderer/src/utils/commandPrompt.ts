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
/**
 * Prepares the prompt to send to the AI provider when the user types a slash command.
 *
 * Steps:
 * 1. Extract the arguments: everything in `prompt` after "/commandName" (may be empty).
 * 2. Strip the optional description frontmatter from `commandContent` — a block at the
 *    very beginning that starts with "---" (optionally "---description: …") and ends
 *    with a line containing only "---".
 * 3. Replace every occurrence of "$ARGUMENTS" in the remaining command text with the
 *    extracted arguments.
 * 4. Return the result as the final prompt.
 */
export function prepareCommandPrompt(prompt: string, commandContent: string): string {
  // 1. Extract arguments (text after "/commandName[ ]")
  const afterSlash = prompt.slice(1) // strip leading "/"
  const spaceIdx = afterSlash.search(/\s/)
  const args = spaceIdx === -1 ? '' : afterSlash.slice(spaceIdx + 1)

  // 2. Strip frontmatter block if present at the start of the command file.
  //    Matches an opening "---…" line followed by any content and a closing "---" line.
  let body = commandContent.replace(/^---[^\n]*\n[\s\S]*?\n---[ \t]*\n?/, '')

  // 3. Replace $ARGUMENTS with the extracted arguments
  body = body.replace(/\$ARGUMENTS/g, args)

  return body
}
