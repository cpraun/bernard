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
import { loadConfig } from './ConfigService'
import * as GeminiFileSearch from './GeminiFileSearchService'
import * as LocalFileSearch from './LocalFileSearchService'

function getActiveService(): typeof GeminiFileSearch | typeof LocalFileSearch | null {
  const config = loadConfig()
  const backend = config.vectorDb?.backend ?? (config.vectorDb?.enabled !== false ? 'lancedb' : 'none')
  if (backend === 'gemini') return GeminiFileSearch
  if (backend === 'lancedb') return LocalFileSearch
  return null
}

export async function onFileAdded(absPath: string, relPath: string): Promise<void> {
  const svc = getActiveService()
  if (svc) return svc.onFileAdded(absPath, relPath)
}

export async function onFileRemoved(relPath: string): Promise<void> {
  const svc = getActiveService()
  if (svc) return svc.onFileRemoved(relPath)
}

export async function onFileChanged(absPath: string, relPath: string): Promise<void> {
  const svc = getActiveService()
  if (svc) return svc.onFileChanged(absPath, relPath)
}

export async function purgeStore(onProgress: (msg: string) => void): Promise<void> {
  const svc = getActiveService()
  if (!svc) throw new Error('No vector database is selected. Choose one in Settings.')
  return svc.purgeStore(onProgress)
}

export async function fullResync(
  skillsDir: string,
  onProgress: (msg: string) => void
): Promise<void> {
  const svc = getActiveService()
  if (!svc) throw new Error('No vector database is selected. Choose one in Settings.')
  return svc.fullResync(skillsDir, onProgress)
}

export function getIndexedFileCount(): number {
  const svc = getActiveService()
  return svc ? svc.getIndexedFileCount() : 0
}

export function getIndexedFiles(): string[] {
  const svc = getActiveService()
  return svc ? svc.getIndexedFiles() : []
}

export function stop(): void {
  GeminiFileSearch.stop()
  LocalFileSearch.stop()
}
