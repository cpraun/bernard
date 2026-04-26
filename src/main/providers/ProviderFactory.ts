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
import type { NAIProvider } from './NAIProvider'
import { AnthropicProvider } from './AnthropicProvider'
import { GeminiProvider } from './GeminiProvider'
import { LocalProvider } from './LocalProvider'
import { OllamaProvider } from './OllamaProvider'
import { VertexProvider } from './VertexProvider'
import { getProviderConfig, loadConfig } from '../services/ConfigService'
import * as GeminiFileSearch from '../services/GeminiFileSearchService'
import * as LocalFileSearch from '../services/LocalFileSearchService'

export function createProvider(providerId: string, overrides?: { temperature?: number; ragDisabled?: boolean }): NAIProvider {
  const baseConfig = getProviderConfig(providerId)
  const config = overrides ? { ...baseConfig, ...overrides } : baseConfig

  const appConfig = loadConfig()
  const vectorBackend = appConfig.vectorDb?.backend ?? (appConfig.vectorDb?.enabled !== false ? 'lancedb' : 'none')
  const lanceDbActive = vectorBackend === 'lancedb'
  const geminiFileSearchActive = vectorBackend === 'gemini'

  const queryRAG = lanceDbActive && !overrides?.ragDisabled
    ? async (text: string): Promise<{ title: string; text: string }[]> => LocalFileSearch.query(text)
    : undefined

  switch (providerId) {
    case 'gemini': {
      if (!config?.apiKey) {
        throw new Error(`No API key configured for provider: gemini. Add it to ~/.bernard/config.json`)
      }
      return new GeminiProvider(
        config.apiKey,
        config.model,
        config.temperature,
        config.topK,
        config.maxOutputTokens,
        geminiFileSearchActive && !overrides?.ragDisabled ? GeminiFileSearch.getStoreName() ?? undefined : undefined,
        queryRAG
      )
    }
    case 'ollama':
      return new OllamaProvider(config?.baseUrl || undefined, config?.model || undefined, queryRAG)
    case 'anthropic': {
      if (!config?.apiKey) {
        throw new Error(`No API key configured for provider: anthropic. Add it to ~/.bernard/config.json`)
      }
      return new AnthropicProvider(
        config.apiKey,
        config.model,
        config.temperature,
        config.maxOutputTokens,
        queryRAG
      )
    }
    case 'openai-local':
      return new LocalProvider(
        config?.baseUrl || undefined,
        queryRAG,
        config?.model || undefined,
        config?.temperature,
        config?.topP,
        config?.maxOutputTokens,
        config?.reasoningEffort
      )
    case 'vertex': {
      if (!config?.projectId) throw new Error('No GCP Project ID configured for provider: vertex')
      if (!config?.endpointId) throw new Error('No Endpoint ID configured for provider: vertex')
      return new VertexProvider(
        config.projectId,
        config.region || 'us-central1',
        config.endpointId,
        config.temperature,
        config.topP,
        config.topK,
        config.maxOutputTokens,
        config.stop,
        queryRAG
      )
    }
    default:
      throw new Error(`Unknown provider: ${providerId}. Supported: gemini, anthropic, ollama, openai-local, vertex`)
  }
}
