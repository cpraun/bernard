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
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getConfigDir } from './ConfigService'

export interface PanelSizes {
  chatSidebar?: number
  agentsSidebar?: number
  commandsSidebar?: number
  skillsSidebar?: number
  toolsSidebar?: number
  contextPanelHeight?: number
  chatInputHeight?: number
}

export interface WindowBounds {
  x?: number
  y?: number
  width?: number
  height?: number
  maximized?: boolean
}

export interface UIState {
  selectedTools?: string[]
  panelSizes?: PanelSizes
  collapsedMCPServers?: string[]
  collapsedSkillDirs?: string[]
  runningMCPServers?: string[]
  windowBounds?: WindowBounds
  previewWindowSize?: { width: number; height: number }
}

function getUIStatePath(): string {
  return join(getConfigDir(), 'ui-state.json')
}

export function loadUIState(): UIState {
  const p = getUIStatePath()
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as UIState
  } catch {
    return {}
  }
}

export function saveUIState(state: UIState): void {
  writeFileSync(getUIStatePath(), JSON.stringify(state, null, 2), 'utf-8')
}

export function patchUIState(partial: Partial<UIState>): void {
  const current = loadUIState()
  if (partial.panelSizes) {
    current.panelSizes = { ...current.panelSizes, ...partial.panelSizes }
  }
  if (partial.selectedTools !== undefined) {
    current.selectedTools = partial.selectedTools
  }
  if (partial.collapsedMCPServers !== undefined) {
    current.collapsedMCPServers = partial.collapsedMCPServers
  }
  if (partial.collapsedSkillDirs !== undefined) {
    current.collapsedSkillDirs = partial.collapsedSkillDirs
  }
  if (partial.runningMCPServers !== undefined) {
    current.runningMCPServers = partial.runningMCPServers
  }
  if (partial.windowBounds !== undefined) {
    current.windowBounds = { ...current.windowBounds, ...partial.windowBounds }
  }
  if (partial.previewWindowSize !== undefined) {
    current.previewWindowSize = partial.previewWindowSize
  }
  saveUIState(current)
}
