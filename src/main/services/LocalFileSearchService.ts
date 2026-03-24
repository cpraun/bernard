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
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, relative, extname } from 'path'
import { getProfileDir } from './ConfigService'
import { parseFile } from './FileParserService'

// ── Index types ───────────────────────────────────────────────────────────────

interface IndexEntry {
  mtime: number
}
type SkillsIndex = Record<string, IndexEntry>

// ── Module-level state ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let table: any = null
let indexPath: string | null = null
let ollamaBaseUrl = 'http://localhost:11434'
let embeddingModel = 'nomic-embed-text'
let embeddingDim = 0
let initialized = false
let defaultTopK = 5
let defaultMaxDistance = 1.0
let useOpenAICompat = false

const TABLE_NAME = 'skills_chunks'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDataDir(): string {
  const dir = join(getProfileDir(), 'lancedb')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function getDefaultIndexPath(): string {
  return join(getProfileDir(), 'local-skills-index.json')
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

// ── Backend connectivity ─────────────────────────────────────────────────────

let backendAvailable = false

async function checkConnection(): Promise<boolean> {
  try {
    if (useOpenAICompat) {
      // OpenAI-compatible: try a lightweight models list
      const res = await fetch(`${ollamaBaseUrl}/v1/models`, { signal: AbortSignal.timeout(5000) })
      return res.ok
    }
    const res = await fetch(`${ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}

// ── Embedding ─────────────────────────────────────────────────────────────────

async function getEmbeddingsOpenAI(texts: string[]): Promise<number[][]> {
  let res: Response
  const url = `${ollamaBaseUrl}/v1/embeddings`
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: embeddingModel, input: texts })
    })
  } catch (err) {
    backendAvailable = false
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Cannot connect to embedding endpoint at ${url}: ${msg}`)
  }

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenAI-compatible embedding error ${res.status}: ${body}`)
  }

  const json = (await res.json()) as { data?: { embedding: number[] }[]; error?: string }
  if (json.error) throw new Error(`Embedding error: ${json.error}`)
  if (json.data) return json.data.map((d) => d.embedding)
  throw new Error(`Embedding response missing data field: ${JSON.stringify(Object.keys(json))}`)
}

async function getEmbeddingsOllama(texts: string[]): Promise<number[][]> {
  let res: Response
  try {
    res = await fetch(`${ollamaBaseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: embeddingModel, input: texts })
    })
  } catch (err) {
    backendAvailable = false
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Cannot connect to Ollama at ${ollamaBaseUrl}: ${msg}. ` +
      'Make sure Ollama is running (ollama serve).'
    )
  }

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 404 && body.includes('not found')) {
      throw new Error(
        `Embedding model "${embeddingModel}" not found. Pull it first: ollama pull ${embeddingModel}`
      )
    }
    throw new Error(`Ollama embedding error ${res.status}: ${body}`)
  }

  const json = (await res.json()) as { embeddings?: number[][]; embedding?: number[]; error?: string }
  if (json.error) throw new Error(`Ollama embedding error: ${json.error}`)
  if (json.embeddings) return json.embeddings
  if (json.embedding) return [json.embedding]
  throw new Error(`Ollama embedding response missing embeddings field: ${JSON.stringify(Object.keys(json))}`)
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (!backendAvailable) {
    backendAvailable = await checkConnection()
    if (!backendAvailable) {
      const target = useOpenAICompat ? `${ollamaBaseUrl}/v1/embeddings` : ollamaBaseUrl
      throw new Error(
        `Embedding backend is not reachable at ${target}. ` +
        (useOpenAICompat
          ? 'Make sure the local server is running.'
          : 'Make sure Ollama is running (ollama serve) and the embedding model is pulled (ollama pull nomic-embed-text).')
      )
    }
  }
  return useOpenAICompat ? getEmbeddingsOpenAI(texts) : getEmbeddingsOllama(texts)
}

async function getEmbedding(text: string): Promise<number[]> {
  const results = await getEmbeddings([text])
  return results[0]
}

// ── Chunking ──────────────────────────────────────────────────────────────────

interface Chunk {
  text: string
  relPath: string
  chunkIndex: number
  heading: string
}

function chunkMarkdown(content: string, relPath: string): Chunk[] {
  const chunks: Chunk[] = []
  const headingRegex = /^(#{1,3} .+)$/gm
  const sections: { heading: string; text: string }[] = []

  let lastIndex = 0
  let lastHeading = '(top)'
  let match: RegExpExecArray | null

  while ((match = headingRegex.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index).trim()
    if (before.length > 0) {
      sections.push({ heading: lastHeading, text: before })
    }
    lastHeading = match[1]
    lastIndex = match.index + match[0].length
  }
  // Remaining text after the last heading
  const remaining = content.slice(lastIndex).trim()
  if (remaining.length > 0) {
    sections.push({ heading: lastHeading, text: remaining })
  }

  let chunkIndex = 0
  for (const section of sections) {
    const fullText = section.heading !== '(top)' ? `${section.heading}\n\n${section.text}` : section.text

    if (fullText.length <= 2000) {
      chunks.push({ text: fullText, relPath, chunkIndex: chunkIndex++, heading: section.heading })
    } else {
      // Sub-split by paragraphs
      const paragraphs = section.text.split(/\n\n+/)
      let current = section.heading !== '(top)' ? `${section.heading}\n\n` : ''

      for (const para of paragraphs) {
        if (current.length + para.length > 2000 && current.trim().length > 0) {
          chunks.push({ text: current.trim(), relPath, chunkIndex: chunkIndex++, heading: section.heading })
          current = section.heading !== '(top)' ? `${section.heading}\n\n` : ''
        }
        current += para + '\n\n'
      }
      if (current.trim().length > 0) {
        chunks.push({ text: current.trim(), relPath, chunkIndex: chunkIndex++, heading: section.heading })
      }
    }
  }

  // Ensure at least one chunk for non-empty content
  if (chunks.length === 0 && content.trim().length > 0) {
    chunks.push({ text: content.trim(), relPath, chunkIndex: 0, heading: '(top)' })
  }

  return chunks
}

const SKILL_EXTS = new Set(['.md', '.pdf', '.docx', '.txt'])

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

async function ensureTable(): Promise<void> {
  if (!db) return
  if (table) return
  const tableNames = await db.tableNames()
  if (tableNames.includes(TABLE_NAME)) {
    table = await db.openTable(TABLE_NAME)
  }
  // Table will be created on first add if it doesn't exist
}

async function indexFile(absPath: string, relPath: string, index: SkillsIndex): Promise<void> {
  if (!db) return
  try {
    const parsed = await parseFile(absPath)
    const content = parsed.content
    const chunks = chunkMarkdown(content, relPath)
    if (chunks.length === 0) return

    // Generate embeddings for all chunks at once
    const embeddings = await getEmbeddings(chunks.map((c) => c.text))

    // Detect embedding dimension on first call
    if (embeddingDim === 0) {
      embeddingDim = embeddings[0].length
    }

    const rows = chunks.map((chunk, i) => ({
      vector: embeddings[i],
      text: chunk.text,
      relPath: chunk.relPath,
      chunkIndex: chunk.chunkIndex,
      heading: chunk.heading
    }))

    if (!table) {
      table = await db.createTable(TABLE_NAME, rows)
    } else {
      await table.add(rows)
    }

    index[relPath] = { mtime: statSync(absPath).mtimeMs }
    saveIndex(index)
  } catch (err) {
    console.error(`[LocalFileSearch] Failed to index ${relPath}:`, err)
  }
}

async function removeFile(relPath: string, index: SkillsIndex): Promise<void> {
  if (!table) return
  try {
    await table.delete(`relPath = '${relPath.replace(/'/g, "''")}'`)
  } catch (err) {
    console.error(`[LocalFileSearch] Failed to delete chunks for ${relPath}:`, err)
  }
  delete index[relPath]
  saveIndex(index)
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function initialize(
  baseUrl: string,
  _skillsDir: string,
  model?: string,
  openaiCompat = false
): Promise<void> {
  useOpenAICompat = openaiCompat
  if (openaiCompat) {
    // Keep the base URL as-is (e.g. http://localhost:1234/v1) — /embeddings is appended per-call
    ollamaBaseUrl = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')
  } else {
    // Strip /v1 suffix if present (Ollama native API is at root)
    ollamaBaseUrl = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')
  }
  if (model) embeddingModel = model
  indexPath = getDefaultIndexPath()

  const dataDir = getDataDir()
  let lancedb: typeof import('@lancedb/lancedb')
  try {
    lancedb = await import('@lancedb/lancedb')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[LocalFileSearch] LanceDB native module not available: ${msg}`)
    throw new Error(
      'LanceDB is not available on this platform. ' +
      'The local vector database cannot be used. ' +
      'Please use Gemini File Search as the vector DB backend instead.'
    )
  }
  db = await lancedb.connect(dataDir)
  await ensureTable()

  // Check backend connectivity (non-blocking — warn but don't fail)
  backendAvailable = await checkConnection()
  if (!backendAvailable) {
    const target = useOpenAICompat ? `${ollamaBaseUrl}/v1/embeddings` : ollamaBaseUrl
    console.warn(
      `[LocalFileSearch] WARNING: Embedding backend is not reachable at ${target}. ` +
      'Embedding operations will fail until the server is started.'
    )
  }

  initialized = true
  const mode = useOpenAICompat ? 'openai-compat' : 'ollama'
  console.log(`[LocalFileSearch] Initialized (LanceDB at ${dataDir}, model: ${embeddingModel}, mode: ${mode}, backend: ${backendAvailable ? 'connected' : 'unreachable'})`)
}

export function getStoreName(): string | null {
  return initialized ? 'lancedb' : null
}

export async function onFileAdded(absPath: string, relPath: string): Promise<void> {
  if (!initialized || !db) return
  const index = loadIndex()
  console.log(`[LocalFileSearch] File added: ${relPath}`)
  await indexFile(absPath, relPath, index)
}

export async function onFileRemoved(relPath: string): Promise<void> {
  if (!initialized || !db) return
  const index = loadIndex()
  console.log(`[LocalFileSearch] File removed: ${relPath}`)
  await removeFile(relPath, index)
}

export async function onFileChanged(absPath: string, relPath: string): Promise<void> {
  if (!initialized || !db) return
  const index = loadIndex()
  console.log(`[LocalFileSearch] File changed: ${relPath}`)
  await removeFile(relPath, index)
  await indexFile(absPath, relPath, index)
}

export async function purgeStore(onProgress: (msg: string) => void): Promise<void> {
  if (!initialized || !db) {
    throw new Error('Local File Search is not initialized — check your Ollama connection and settings.')
  }

  const index = loadIndex()
  const entries = Object.keys(index)
  onProgress(`Purging ${entries.length} file(s) from local vector store…`)

  if (table) {
    try {
      await db.dropTable(TABLE_NAME)
      table = null
    } catch (err) {
      console.error('[LocalFileSearch] Failed to drop table:', err)
    }
  }

  // Clear the index
  for (const key of Object.keys(index)) delete index[key]
  saveIndex(index)

  onProgress(`Purge complete — ${entries.length} file(s) removed`)
}

export async function fullResync(
  skillsDir: string,
  onProgress: (msg: string) => void
): Promise<void> {
  if (!initialized || !db) {
    throw new Error('Local File Search is not initialized — check your Ollama connection and settings.')
  }

  // Verify backend is reachable before starting a potentially long operation
  backendAvailable = await checkConnection()
  if (!backendAvailable) {
    const target = useOpenAICompat ? `${ollamaBaseUrl}/v1/embeddings` : ollamaBaseUrl
    throw new Error(
      `Embedding backend is not reachable at ${target}. ` +
      (useOpenAICompat
        ? 'Make sure the local server is running.'
        : 'Make sure Ollama is running (ollama serve) and the embedding model is pulled (ollama pull nomic-embed-text).')
    )
  }

  // Step 1: Drop existing table
  if (table) {
    try {
      await db.dropTable(TABLE_NAME)
      table = null
    } catch {
      // Table may not exist
    }
  }

  // Clear index
  const index: SkillsIndex = {}
  saveIndex(index)

  // Step 2: Collect and index all skill files
  const localFiles = collectSkillFiles(skillsDir, skillsDir)
  onProgress(`Indexing ${localFiles.length} file(s)…`)

  for (let i = 0; i < localFiles.length; i++) {
    const { absPath, relPath } = localFiles[i]
    onProgress(`Embedding (${i + 1}/${localFiles.length}): ${relPath}`)
    await indexFile(absPath, relPath, index)
  }

  onProgress(`Sync complete — ${localFiles.length} file(s) indexed`)
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

export function setQueryParams(topK?: number, maxDistance?: number): void {
  if (topK != null) defaultTopK = topK
  if (maxDistance != null) defaultMaxDistance = maxDistance
}

export async function query(
  text: string,
  topK = defaultTopK,
  maxDistance = defaultMaxDistance
): Promise<{ title: string; text: string }[]> {
  if (!initialized || !table || topK <= 0) return []

  try {
    const queryVec = await getEmbedding(text)
    const results = await table.vectorSearch(queryVec).limit(topK).toArray()

    const filtered = results.filter((row) => (row._distance as number) <= maxDistance)
    console.log(
      `[LocalFileSearch] Query: ${results.length} results, ${filtered.length} after distance filter (threshold: ${maxDistance})`
    )

    return filtered.map((row) => ({
      title: `${row.relPath as string} (${row.heading as string})`,
      text: row.text as string
    }))
  } catch (err) {
    console.error('[LocalFileSearch] Query failed:', err)
    return []
  }
}

export function stop(): void {
  db = null
  table = null
  initialized = false
  embeddingDim = 0
  useOpenAICompat = false
}
