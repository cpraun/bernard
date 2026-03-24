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
 * Accumulates timestamped log entries for a single AI provider interaction
 * (from user send to final response or abort).
 */
export class InteractionLogger {
  private lines: string[] = []

  log(event: string, detail: string): void {
    const ts = new Date().toISOString().slice(11, 23) // HH:MM:SS.mmm
    this.lines.push(`[${ts}] ${event}: ${detail}`)
  }

  toString(): string {
    return this.lines.join('\n') + '\n'
  }
}
