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
import { GoogleGenAI } from '@google/genai'
import type { UploadToFileSearchStoreOperation, UploadToFileSearchStoreResponse } from '@google/genai'
import { readdirSync, writeFileSync, statSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join, relative, extname } from 'path'
import { getProfileDir, loadConfig, saveConfig } from './ConfigService'

// ── Index types ───────────────────────────────────────────────────────────────

interface IndexEntry {
  documentName: string
  mtime: number
}
type SkillsIndex = Record<string, IndexEntry>

// ── Module-level state ────────────────────────────────────────────────────────

let ai: GoogleGenAI | null = null
let storeName: string | null = null
let indexPath: string | null = null

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDefaultIndexPath(): string {
  return join(getProfileDir(), 'gemini-skills-index.json')
}

function loadIndex(): SkillsIndex {
  try {
    return JSON.parse(readFileSync(indexPath!, 'utf-8')) as SkillsIndex
  } catch {
    return {}
  }
}

function saveIndex(index: SkillsIndex): void {
  writeFileSync(indexPath!, JSON.stringify(index, null, 2), 'utf-8')
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function pollUploadOperation(
  op: UploadToFileSearchStoreOperation
): Promise<string | null> {
  let current: UploadToFileSearchStoreOperation = op
  while (!current.done) {
    await sleep(2000)
    current = (await ai!.operations.get<
      UploadToFileSearchStoreResponse,
      UploadToFileSearchStoreOperation
    >({ operation: current })) as UploadToFileSearchStoreOperation
  }
  if (current.error) {
    const msg = (current.error as { message?: string }).message ?? 'Upload failed'
    throw new Error(msg)
  }
  return current.response?.documentName ?? null
}

const SKILL_EXTS = new Set(['.md', '.pdf', '.txt'])

function collectSkillFiles(dir: string, root: string): Array<{ absPath: string; relPath: string }> {
  const results: Array<{ absPath: string; relPath: string }> = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = String(entry.name)
      if (entry.isDirectory() && !name.startsWith('.')) {
        results.push(...collectSkillFiles(join(dir, name), root))
      } else if (entry.isFile() && SKILL_EXTS.has(extname(name).toLowerCase())) {
        results.push({ absPath: join(dir, name), relPath: relative(root, join(dir, name)) })
      }
    }
  } catch {
    // Ignore unreadable directories
  }
  return results
}

// ── Internal sync primitives ──────────────────────────────────────────────────

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.pdf': return 'application/pdf'
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    default: return 'text/plain'
  }
}

async function uploadFile(absPath: string, relPath: string, index: SkillsIndex): Promise<void> {
  if (!ai || !storeName) return
  try {
    const op = await ai.fileSearchStores.uploadToFileSearchStore({
      file: absPath,
      fileSearchStoreName: storeName,
      config: { displayName: relPath, mimeType: getMimeType(absPath) }
    })
    const documentName = await pollUploadOperation(op)
    if (documentName) {
      index[relPath] = { documentName, mtime: statSync(absPath).mtimeMs }
      saveIndex(index)
    }
  } catch (err) {
    console.error(`[GeminiFileSearch] Failed to upload ${relPath}:`, err)
  }
}

async function deleteDoc(relPath: string, index: SkillsIndex): Promise<void> {
  if (!ai) return
  const entry = index[relPath]
  if (!entry) return
  try {
    await ai.fileSearchStores.documents.delete({ name: entry.documentName, config: { force: true } })
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 404) {
      // Already gone from the store — just clean up the local index
    } else {
      console.error(`[GeminiFileSearch] Failed to delete doc for ${relPath}:`, err)
    }
  }
  delete index[relPath]
  saveIndex(index)
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function initialize(apiKey: string, skillsDir: string): Promise<void> {
  ai = new GoogleGenAI({ apiKey })
  indexPath = getDefaultIndexPath()

  // 1. Create or reuse the File Search Store
  const config = loadConfig()
  if (config.geminiFileSearchStoreName) {
    storeName = config.geminiFileSearchStoreName
    console.log(`[GeminiFileSearch] Reusing store: ${storeName}`)
  } else {
    try {
      const store = await ai.fileSearchStores.create({
        config: { displayName: 'nai-chat-skills' }
      })
      storeName = store.name ?? null
      if (storeName) {
        saveConfig({ ...loadConfig(), geminiFileSearchStoreName: storeName })
        console.log(`[GeminiFileSearch] Created store: ${storeName}`)
      } else {
        console.error('[GeminiFileSearch] Store creation returned no name')
        return
      }
    } catch (err) {
      console.error('[GeminiFileSearch] Failed to create store:', err)
      return
    }
  }

  console.log('[GeminiFileSearch] Initialized')
}

export function getStoreName(): string | null {
  return storeName
}

export async function onFileAdded(absPath: string, relPath: string): Promise<void> {
  if (!ai || !storeName) return
  const index = loadIndex()
  console.log(`[GeminiFileSearch] File added: ${relPath}`)
  await uploadFile(absPath, relPath, index)
}

export async function onFileRemoved(relPath: string): Promise<void> {
  if (!ai || !storeName) return
  const index = loadIndex()
  console.log(`[GeminiFileSearch] File removed: ${relPath}`)
  await deleteDoc(relPath, index)
}

export async function onFileChanged(absPath: string, relPath: string): Promise<void> {
  if (!ai || !storeName) return
  const index = loadIndex()
  console.log(`[GeminiFileSearch] File changed: ${relPath}`)
  await deleteDoc(relPath, index)
  await uploadFile(absPath, relPath, index)
}

export async function purgeStore(onProgress: (msg: string) => void): Promise<void> {
  if (!ai || !storeName) {
    throw new Error('Gemini File Search is not initialized — check your API key and settings.')
  }
  const index = loadIndex()
  const entries = Object.keys(index)
  onProgress(`Purging ${entries.length} document(s) from File Search Store…`)
  for (const relPath of entries) {
    onProgress(`Deleting: ${relPath}`)
    await deleteDoc(relPath, index)
  }
  onProgress(`Purge complete — ${entries.length} document(s) deleted`)
}

export async function fullResync(
  skillsDir: string,
  onProgress: (msg: string) => void
): Promise<void> {
  if (!ai || !storeName) {
    throw new Error('Gemini File Search is not initialized — check your API key and settings.')
  }

  const index = loadIndex()
  const entries = Object.keys(index)

  // Step 1: Delete all indexed documents from the store
  onProgress(`Deleting ${entries.length} document(s) from File Search Store…`)
  for (const relPath of entries) {
    onProgress(`Deleting: ${relPath}`)
    await deleteDoc(relPath, index)
  }

  // Step 2: Collect all local skill files and upload them
  const localFiles = collectSkillFiles(skillsDir, skillsDir)
  onProgress(`Uploading ${localFiles.length} file(s)…`)
  for (let i = 0; i < localFiles.length; i++) {
    const { absPath, relPath } = localFiles[i]
    onProgress(`Uploading (${i + 1}/${localFiles.length}): ${relPath}`)
    await uploadFile(absPath, relPath, index)
  }

  onProgress(`Sync complete — ${localFiles.length} file(s) uploaded`)
}

export function getIndexedFileCount(): number {
  try {
    return Object.keys(loadIndex()).length
  } catch {
    return 0
  }
}

export function getIndexedFiles(): string[] {
  try {
    return Object.keys(loadIndex())
  } catch {
    return []
  }
}

export function stop(): void {
  storeName = null
  ai = null
}
