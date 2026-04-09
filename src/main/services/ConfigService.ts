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
import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  embeddingModel?: string
  enabled?: boolean
  temperature?: number
  topK?: number
  topP?: number
  maxOutputTokens?: number
  reasoningEffort?: 'low' | 'medium' | 'high'
  stop?: string[]
  projectId?: string
  region?: string
  endpointId?: string
  ragTopK?: number
  ragMaxDistance?: number
}

export interface VectorDbConfig {
  backend?: 'none' | 'lancedb' | 'gemini'
  embeddingProvider?: 'ollama' | 'openai-local'
  ragTopK?: number
  ragMaxDistance?: number
  /** @deprecated use backend instead */
  enabled?: boolean
}

export interface AppConfig {
  providers: Record<string, ProviderConfig>
  defaultProvider: string
  vectorDb?: VectorDbConfig
  projectDir?: string
  profileDir?: string
  /** @deprecated use profileDir */
  skillsDir?: string
  /** @deprecated use profileDir */
  commandsDir?: string
  /** @deprecated use projectDir */
  dataDir?: string
  geminiFileSearchStoreName?: string
  showSplashScreen?: boolean
  showWelcomePopup?: boolean
  loggingEnabled?: boolean
  theme?: 'light' | 'dark' | 'auto'
  wordExportTemplatePath?: string
}

const DEFAULT_CONFIG: AppConfig = {
  providers: {},
  defaultProvider: 'gemini'
}

export function getConfigDir(): string {
  const dir = join(app.getPath('home'), '.bernard')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    // Copy base-directory contents into ~/.bernard/ on first startup
    const baseSrc = app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'base-directory')
      : join(app.getAppPath(), 'resources', 'base-directory')
    if (existsSync(baseSrc)) {
      cpSync(baseSrc, dir, { recursive: true })
    }
  }
  return dir
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json')
}

export function loadConfig(): AppConfig {
  const configPath = getConfigPath()
  if (!existsSync(configPath)) {
    saveConfig(DEFAULT_CONFIG)
    return DEFAULT_CONFIG
  }
  try {
    const raw = readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as AppConfig
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: AppConfig): void {
  const configPath = getConfigPath()
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

export function getProviderConfig(providerId: string): ProviderConfig | undefined {
  const config = loadConfig()
  return config.providers[providerId]
}

export function getProjectDir(): string {
  const config = loadConfig()
  const dir =
    config.projectDir ||
    (config.dataDir ? join(config.dataDir, 'projects') : null) ||
    join(app.getPath('home'), '.bernard', 'projects')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getProfileDir(): string {
  const config = loadConfig()
  const dir = config.profileDir || join(getConfigDir(), 'demo-profile')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getSkillsDir(): string {
  const config = loadConfig()
  // Legacy fallback: use skillsDir if explicitly set
  const dir = config.skillsDir || join(getProfileDir(), 'skills')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getCommandsDir(): string {
  const config = loadConfig()
  // Legacy fallback: use commandsDir if explicitly set
  const dir = config.commandsDir || join(getProfileDir(), 'commands')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getAgentsDir(): string {
  const dir = join(getProfileDir(), 'agents')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getToolsDir(): string {
  const dir = join(getProfileDir(), 'tools')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

