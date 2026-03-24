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
import { readdirSync, unlinkSync, writeFileSync, copyFileSync, mkdirSync, statSync, existsSync, renameSync } from 'fs'
import type { Dirent } from 'fs'
import { join, extname, relative, resolve, sep, basename } from 'path'
import { ipcMain, BrowserWindow } from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'
import { parseFile } from '../services/FileParserService'
import { getSkillsDir } from '../services/ConfigService'
import * as FileSearchRouter from '../services/FileSearchRouter'

interface SkillFile { kind: 'file'; name: string; path: string; content: string; size: number }
interface SkillDir  { kind: 'dir';  name: string; path: string; children: SkillTreeNode[] }
type SkillTreeNode = SkillFile | SkillDir

async function buildTree(dirPath: string, rootDir: string): Promise<SkillTreeNode[]> {
  let entries: Dirent[]
  try {
    entries = readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const byName = (a: Dirent, b: Dirent): number => String(a.name).localeCompare(String(b.name))
  const dirs  = entries.filter((e) => e.isDirectory() && !String(e.name).startsWith('.')).sort(byName)
  const SKILL_EXTS = new Set(['.md', '.pdf', '.docx', '.txt', '.msg'])
  const isKebab = (name: string): boolean => /^[a-z0-9]+(-[a-z0-9]+)*\.[a-z]+$/.test(name)
  const files = entries
    .filter((e) => {
      const name = String(e.name)
      const ext = extname(name).toLowerCase()
      return e.isFile() && SKILL_EXTS.has(ext) && (ext === '.md' || ext === '.msg' || isKebab(name))
    })
    .sort(byName)

  const result: SkillTreeNode[] = []

  for (const dir of dirs) {
    const childPath = join(dirPath, String(dir.name))
    const children  = await buildTree(childPath, rootDir)
    if (children.length > 0) {
      result.push({ kind: 'dir', name: String(dir.name), path: relative(rootDir, childPath), children })
    }
  }

  for (const file of files) {
    const filePath = join(dirPath, String(file.name))
    try {
      const parsed = await parseFile(filePath)
      result.push({
        kind: 'file',
        name: String(file.name),
        path: relative(rootDir, filePath),
        content: parsed.content,
        size: parsed.size
      })
    } catch {
      // skip files that fail to parse
    }
  }

  return result
}

// ── Watcher ───────────────────────────────────────────────────────────────────

let skillsWatcher: FSWatcher | null = null
let skillsDebounceTimer: ReturnType<typeof setTimeout> | null = null

function notifySkillsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('skills:changed')
  }
}

function scheduleSkillsNotification(): void {
  if (skillsDebounceTimer !== null) clearTimeout(skillsDebounceTimer)
  skillsDebounceTimer = setTimeout(() => {
    skillsDebounceTimer = null
    notifySkillsChanged()
  }, 200)
}

export function stopSkillsWatcher(): void {
  if (skillsDebounceTimer !== null) {
    clearTimeout(skillsDebounceTimer)
    skillsDebounceTimer = null
  }
  if (skillsWatcher) {
    skillsWatcher.close()
    skillsWatcher = null
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

export function registerSkillsHandlers(): void {
  ipcMain.handle('skills:save', async (_event, relativePath: string, content: string) => {
    const skillsDir = getSkillsDir()
    const resolved  = resolve(join(skillsDir, relativePath))
    if (!resolved.startsWith(resolve(skillsDir) + sep)) {
      throw new Error('Invalid path')
    }
    writeFileSync(resolved, content, 'utf-8')
  })

  ipcMain.handle('skills:create', async () => {
    const skillsDir = getSkillsDir()
    let filename = 'new-skill.md'
    let counter = 2
    while (existsSync(join(skillsDir, filename))) {
      filename = `new-skill-${counter++}.md`
    }
    const template = `---\ndescription: \n---\n\nDescribe the skill content here.\n`
    writeFileSync(join(skillsDir, filename), template, 'utf-8')
    return filename
  })

  ipcMain.handle('skills:delete', (_event, relativePath: string) => {
    const skillsDir = getSkillsDir()
    const resolved = resolve(join(skillsDir, relativePath))
    if (!resolved.startsWith(resolve(skillsDir) + sep)) throw new Error('Invalid path')
    unlinkSync(resolved)
  })

  ipcMain.handle('skills:rename', (_event, oldPath: string, newPath: string) => {
    const skillsDir = getSkillsDir()
    const resolvedOld = resolve(join(skillsDir, oldPath))
    const resolvedNew = resolve(join(skillsDir, newPath))
    if (!resolvedOld.startsWith(resolve(skillsDir) + sep)) throw new Error('Invalid path')
    if (!resolvedNew.startsWith(resolve(skillsDir) + sep)) throw new Error('Invalid path')
    renameSync(resolvedOld, resolvedNew)
  })

  ipcMain.handle('skills:list', async () => {
    const skillsDir = getSkillsDir()
    return buildTree(skillsDir, skillsDir)
  })

  ipcMain.handle('skills:importPaths', async (_event, paths: string[]) => {
    const skillsDir = getSkillsDir()
    const IMPORT_EXTS = new Set(['.md', '.pdf', '.docx', '.txt', '.msg'])
    const isKebab = (name: string): boolean => /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z]+)?$/.test(name)

    function toKebab(name: string): string {
      const ext = extname(name)
      const stem = name.slice(0, -ext.length)
      return stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + ext.toLowerCase()
    }

    function importFile(srcPath: string, destDir: string): void {
      const name = basename(srcPath)
      const ext = extname(name).toLowerCase()
      if (!IMPORT_EXTS.has(ext)) return
      const targetName = isKebab(name) ? name : toKebab(name)
      if (!targetName || targetName === ext) return
      const dest = join(destDir, targetName)
      copyFileSync(srcPath, dest)
    }

    function importDir(srcDir: string, destDir: string): void {
      const dirName = basename(srcDir)
      if (dirName.startsWith('.') || !isKebab(dirName)) return
      const targetDir = join(destDir, dirName)
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
      for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
        const name = String(entry.name)
        const entryPath = join(srcDir, name)
        if (entry.isDirectory()) {
          importDir(entryPath, targetDir)
        } else if (entry.isFile()) {
          importFile(entryPath, targetDir)
        }
      }
    }

    for (const p of paths) {
      const stat = statSync(p, { throwIfNoEntry: false })
      if (!stat) continue
      if (stat.isDirectory()) {
        importDir(p, skillsDir)
      } else if (stat.isFile()) {
        importFile(p, skillsDir)
      }
    }
  })

  ipcMain.handle('skills:purgeFileStore', async () => {
    const sendStatus = (msg: string): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('skills:syncStatus', msg)
      }
    }
    await FileSearchRouter.purgeStore(sendStatus)
  })

  ipcMain.handle('skills:fileStoreCount', () => FileSearchRouter.getIndexedFileCount())
  ipcMain.handle('skills:listFileStore', () => FileSearchRouter.getIndexedFiles())

  ipcMain.handle('skills:syncFileStore', async () => {
    const skillsDir = getSkillsDir()
    const sendStatus = (msg: string): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('skills:syncStatus', msg)
      }
    }
    await FileSearchRouter.fullResync(skillsDir, sendStatus)
  })

  // Start watching the skills directory for external file changes
  const skillsDir = getSkillsDir()
  skillsWatcher = chokidar.watch(skillsDir, {
    depth: undefined,       // recursive — mirrors buildTree
    ignoreInitial: true,
    persistent: true,
    ignorePermissionErrors: true
  })
  const WATCHED_EXTS = new Set(['.md', '.pdf', '.docx', '.txt', '.msg'])
  const isWatchedExt = (p: string): boolean => WATCHED_EXTS.has(extname(p).toLowerCase())
  skillsWatcher.on('add', (p: string) => {
    if (isWatchedExt(p)) {
      scheduleSkillsNotification()
      FileSearchRouter.onFileAdded(p, relative(skillsDir, p)).catch(console.error)
    }
  })
  skillsWatcher.on('unlink', (p: string) => {
    if (isWatchedExt(p)) {
      scheduleSkillsNotification()
      FileSearchRouter.onFileRemoved(relative(skillsDir, p)).catch(console.error)
    }
  })
  skillsWatcher.on('change', (p: string) => {
    if (isWatchedExt(p)) {
      scheduleSkillsNotification()
      FileSearchRouter.onFileChanged(p, relative(skillsDir, p)).catch(console.error)
    }
  })
  skillsWatcher.on('addDir',    (p: string) => { if (p !== skillsDir) scheduleSkillsNotification() })
  skillsWatcher.on('unlinkDir', () => scheduleSkillsNotification())
}
