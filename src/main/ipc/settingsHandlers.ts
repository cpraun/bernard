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
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { OAuth2Client } from 'google-auth-library'
import { loadConfig, saveConfig, getProjectDir, getSkillsDir, type AppConfig } from '../services/ConfigService'
import { createProvider } from '../providers/ProviderFactory'
import { initDirectorySync } from '../services/DirectoryWatcherService'
import * as GeminiFileSearch from '../services/GeminiFileSearchService'
import * as LocalFileSearch from '../services/LocalFileSearchService'

// Google's well-known public OAuth credentials for desktop/CLI applications.
// These are the same credentials used by `gcloud auth login` and are intentionally
// public — they identify the application type, not a private secret.
// See: https://cloud.google.com/sdk/docs/authorizing
const GCLOUD_CLIENT_ID = '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com'
const GCLOUD_CLIENT_SECRET = 'd-FL95Q19q7MQmFpd7hHD0Ty'
const GCLOUD_REDIRECT_URI = 'http://localhost'
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

function getAdcPath(): string {
  const home = app.getPath('home')
  return join(home, '.config', 'gcloud', 'application_default_credentials.json')
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:selectDirectory', async (_event, defaultPath?: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultPath || undefined
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('settings:selectFile', async (_event, defaultPath?: string, filters?: { name: string; extensions: string[] }[]) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      defaultPath: defaultPath || undefined,
      filters: filters || undefined
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('settings:get', async () => {
    return loadConfig()
  })

  ipcMain.handle('settings:update', async (_event, config: AppConfig) => {
    const oldConfig = loadConfig()
    const oldProjectDir = getProjectDir()
    saveConfig(config)
    const newProjectDir = getProjectDir()
    if (oldProjectDir !== newProjectDir) {
      initDirectorySync()
    }

    // Determine vector DB backend (with backwards compat for old `enabled` field)
    const oldBackend = oldConfig.vectorDb?.backend ?? (oldConfig.vectorDb?.enabled !== false ? 'lancedb' : 'none')
    const newBackend = config.vectorDb?.backend ?? (config.vectorDb?.enabled !== false ? 'lancedb' : 'none')

    // Initialize Gemini File Search when backend switches to gemini
    const hasApiKey = !!config.providers['gemini']?.apiKey
    if (newBackend === 'gemini' && oldBackend !== 'gemini' && hasApiKey) {
      GeminiFileSearch.initialize(config.providers['gemini'].apiKey!, getSkillsDir()).catch(console.error)
    }

    // Initialize local file search when LanceDB becomes active or embedding provider changes
    const wasLanceActive = oldBackend === 'lancedb'
    const isLanceActive = newBackend === 'lancedb'
    const oldEmbeddingProvider = oldConfig.vectorDb?.embeddingProvider ?? 'ollama'
    const newEmbeddingProvider = config.vectorDb?.embeddingProvider ?? 'ollama'
    if (isLanceActive && (!wasLanceActive || oldEmbeddingProvider !== newEmbeddingProvider)) {
      const embeddingProviderId = newEmbeddingProvider
      const isOpenAILocal = embeddingProviderId === 'openai-local'
      const baseUrl = config.providers[embeddingProviderId]?.baseUrl || (isOpenAILocal ? 'http://localhost:1234/v1' : 'http://localhost:11434')
      LocalFileSearch.initialize(baseUrl, getSkillsDir(), undefined, isOpenAILocal).catch(console.error)
    }

    // Always update RAG query params when LanceDB is active
    if (isLanceActive) {
      LocalFileSearch.setQueryParams(config.vectorDb?.ragTopK, config.vectorDb?.ragMaxDistance)
    }
  })

  ipcMain.handle('settings:testProvider', async (_event, providerId: string) => {
    try {
      const provider = createProvider(providerId)
      if (provider.testConnection) {
        const info = await provider.testConnection()
        return { success: true, ...info }
      }
      const response = await provider.sendMessage([{ role: 'user', content: 'Hello' }])
      return { success: true, model: response.model }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMain.handle('settings:testEmbeddings', async (_event, providerId: string) => {
    try {
      const config = loadConfig()
      const provCfg = config.providers[providerId]
      const isOpenAILocal = providerId === 'openai-local'
      const rawBase = (provCfg?.baseUrl || (isOpenAILocal ? 'http://localhost:1234/v1' : 'http://localhost:11434')).replace(/\/v1\/?$/, '').replace(/\/$/, '')

      if (isOpenAILocal) {
        // Query /v1/models and look for an embedding model by name
        const modelsUrl = `${rawBase}/v1/models`
        const res = await fetch(modelsUrl, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
        const json = (await res.json()) as { data?: { id: string }[] }
        const models = json.data ?? []
        const embedModel = models.find((m) => /embed|bert/i.test(m.id))
        if (!embedModel) {
          throw new Error('No embedding model found. Loaded models must include "embed" or "bert" in their name.')
        }
        // Verify the model can actually compute embeddings
        const embedUrl = `${rawBase}/v1/embeddings`
        const embedRes = await fetch(embedUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: embedModel.id, input: ['test'] }),
          signal: AbortSignal.timeout(10000)
        })
        if (!embedRes.ok) throw new Error(`Embedding model "${embedModel.id}" failed: ${embedRes.status}: ${await embedRes.text()}`)
        const embedJson = (await embedRes.json()) as { data?: { embedding?: number[] }[] }
        const dim = embedJson.data?.[0]?.embedding?.length ?? 0
        return { success: true, endpoint: embedUrl, model: embedModel.id, dim }
      } else {
        // Ollama native: POST /api/embed with configured model
        const model = provCfg?.embeddingModel || 'nomic-embed-text'
        const url = `${rawBase}/api/embed`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, input: ['test'] }),
          signal: AbortSignal.timeout(10000)
        })
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
        const json = (await res.json()) as { embeddings?: number[][] }
        const dim = json.embeddings?.[0]?.length ?? 0
        return { success: true, endpoint: url, model, dim }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMain.handle('settings:checkProviders', async () => {
    const cfg = loadConfig()
    const results: Record<string, boolean> = {}
    for (const id of ['anthropic', 'gemini', 'vertex', 'ollama', 'openai-local']) {
      const prov = cfg.providers[id]
      if (id === 'anthropic' || id === 'gemini') {
        results[id] = !!prov?.apiKey
      } else if (id === 'vertex') {
        if (!(prov?.projectId && prov?.endpointId)) {
          results[id] = false
        } else {
          try {
            const provider = createProvider(id)
            if (provider.testConnection) {
              const info = await provider.testConnection()
              results[id] = !!info.displayName && !info.displayName.includes('No models deployed')
            } else {
              results[id] = true
            }
          } catch {
            results[id] = false
          }
        }
      } else {
        // Local providers: check connectivity with a short timeout
        const rawBaseUrl = (prov?.baseUrl || (id === 'openai-local' ? 'http://localhost:1234/v1' : 'http://localhost:11434')).replace(/\/+$/, '')
        try {
          const url = id === 'ollama'
            ? `${rawBaseUrl}/api/tags`
            : `${rawBaseUrl.replace(/\/v1$/, '')}/v1/models`
          const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
          results[id] = res.ok
        } catch {
          results[id] = false
        }
      }
    }
    return results
  })

  ipcMain.handle('settings:listOpenaiLocalModels', async (): Promise<string[]> => {
    try {
      const cfg = loadConfig()
      const baseUrl = (cfg.providers['openai-local']?.baseUrl || 'http://localhost:1234/v1').replace(/\/+$/, '').replace(/\/v1$/, '')
      const res = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return []
      const json = (await res.json()) as { data?: { id: string }[] }
      return (json.data ?? []).filter((m) => !/embed|bert/i.test(m.id)).map((m) => m.id)
    } catch {
      return []
    }
  })

  ipcMain.handle('settings:listEmbeddingModels', async (_event, providerId: string): Promise<string[]> => {
    try {
      const cfg = loadConfig()
      const provCfg = cfg.providers[providerId]
      const isOpenAILocal = providerId === 'openai-local'
      const rawBase = (provCfg?.baseUrl || (isOpenAILocal ? 'http://localhost:1234/v1' : 'http://localhost:11434')).replace(/\/v1\/?$/, '').replace(/\/$/, '')

      if (isOpenAILocal) {
        const res = await fetch(`${rawBase}/v1/models`, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) return []
        const json = (await res.json()) as { data?: { id: string }[] }
        return (json.data ?? []).filter((m) => /embed/i.test(m.id)).map((m) => m.id)
      } else {
        // Ollama: GET /api/tags returns { models: [{ name, ... }] }
        const res = await fetch(`${rawBase}/api/tags`, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) return []
        const json = (await res.json()) as { models?: { name: string }[] }
        return (json.models ?? []).map((m) => m.name).filter((name) => /embed/i.test(name))
      }
    } catch {
      return []
    }
  })

  ipcMain.handle('settings:checkAdc', async () => {
    try {
      const adcPath = getAdcPath()
      if (!existsSync(adcPath)) return { valid: false }
      const raw = readFileSync(adcPath, 'utf-8')
      const creds = JSON.parse(raw)
      if (creds.type !== 'authorized_user' || !creds.refresh_token) return { valid: false }

      // Actually validate the credential by refreshing the access token
      const oauth2Client = new OAuth2Client(
        creds.client_id || GCLOUD_CLIENT_ID,
        creds.client_secret || GCLOUD_CLIENT_SECRET
      )
      oauth2Client.setCredentials({ refresh_token: creds.refresh_token })
      await oauth2Client.getAccessToken()
      return { valid: true }
    } catch {
      return { valid: false }
    }
  })

  ipcMain.handle('settings:loginGoogle', async () => {
    try {
      const oauth2Client = new OAuth2Client(GCLOUD_CLIENT_ID, GCLOUD_CLIENT_SECRET, GCLOUD_REDIRECT_URI)
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [CLOUD_PLATFORM_SCOPE]
      })

      return await new Promise<{ success: boolean; error?: string }>((resolve) => {
        const authWin = new BrowserWindow({
          width: 600,
          height: 700,
          title: 'Sign In with Google',
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        })

        let resolved = false
        const finish = (result: { success: boolean; error?: string }): void => {
          if (resolved) return
          resolved = true
          if (!authWin.isDestroyed()) authWin.close()
          resolve(result)
        }

        authWin.webContents.on('will-redirect', async (_event, url) => {
          if (!url.startsWith(GCLOUD_REDIRECT_URI)) return
          try {
            const parsed = new URL(url)
            const code = parsed.searchParams.get('code')
            const error = parsed.searchParams.get('error')
            if (error) {
              finish({ success: false, error: `Google auth error: ${error}` })
              return
            }
            if (!code) {
              finish({ success: false, error: 'No authorization code received' })
              return
            }
            const { tokens } = await oauth2Client.getToken(code)
            if (!tokens.refresh_token) {
              finish({ success: false, error: 'No refresh token received. Try revoking access and signing in again.' })
              return
            }
            const adcJson = {
              type: 'authorized_user',
              client_id: GCLOUD_CLIENT_ID,
              client_secret: GCLOUD_CLIENT_SECRET,
              refresh_token: tokens.refresh_token
            }
            const adcPath = getAdcPath()
            const adcDir = join(adcPath, '..')
            if (!existsSync(adcDir)) mkdirSync(adcDir, { recursive: true })
            writeFileSync(adcPath, JSON.stringify(adcJson, null, 2), 'utf-8')
            finish({ success: true })
          } catch (err) {
            finish({ success: false, error: err instanceof Error ? err.message : String(err) })
          }
        })

        authWin.on('closed', () => {
          finish({ success: false, error: 'Authentication window was closed' })
        })

        authWin.loadURL(authUrl)
      })
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })
}
