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
import { readdirSync } from 'fs'
import { basename } from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import { BrowserWindow } from 'electron'
import { getProjectDir } from './ConfigService'
import {
  createProjectForDirectory,
  removeDirectoryProject,
  getDirectoryProjectDirNames,
  listProjects
} from './ProjectService'

let watcher: FSWatcher | null = null

const IGNORED_DIRS = new Set<string>([])

function shouldIgnore(dirName: string): boolean {
  return dirName.startsWith('.') || IGNORED_DIRS.has(dirName)
}

/**
 * Scan the dataDir for immediate subdirectories and sync project entries.
 */
export function scanAndSyncProjects(): void {
  const dataDir = getProjectDir()

  let dirNames: string[]
  try {
    const entries = readdirSync(dataDir, { withFileTypes: true })
    dirNames = entries
      .filter((e) => e.isDirectory())
      .map((e) => String(e.name))
      .filter((name) => !shouldIgnore(name))
  } catch {
    return
  }

  const tracked = new Set(getDirectoryProjectDirNames())

  // Add new directories
  for (const dir of dirNames) {
    if (!tracked.has(dir)) {
      createProjectForDirectory(dir)
    }
  }

  // Remove projects for directories that no longer exist
  const currentDirs = new Set(dirNames)
  for (const dirName of tracked) {
    if (!currentDirs.has(dirName)) {
      removeDirectoryProject(dirName)
    }
  }
}

/**
 * Notify all renderer windows that the project list has changed.
 */
export function notifyProjectListChanged(): void {
  const projects = listProjects()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('projects:changed', projects)
  }
}

/**
 * Start watching the dataDir for subdirectory additions/removals.
 */
export function startWatcher(): void {
  stopWatcher()

  const dataDir = getProjectDir()

  watcher = chokidar.watch(dataDir, {
    depth: 0,
    ignoreInitial: true,
    persistent: true,
    ignorePermissionErrors: true
  })

  watcher.on('addDir', (dirPath: string) => {
    const dirName = basename(dirPath)
    if (dirPath === dataDir || shouldIgnore(dirName)) return
    createProjectForDirectory(dirName)
    notifyProjectListChanged()
  })

  watcher.on('unlinkDir', (dirPath: string) => {
    const dirName = basename(dirPath)
    removeDirectoryProject(dirName)
    notifyProjectListChanged()
  })
}

/**
 * Stop the current watcher, if any.
 */
export function stopWatcher(): void {
  if (watcher) {
    watcher.close()
    watcher = null
  }
}

/**
 * Full restart: scan, sync, then start watching.
 * Call on app startup and when dataDir changes.
 */
export function initDirectorySync(): void {
  scanAndSyncProjects()
  startWatcher()
  notifyProjectListChanged()
}
