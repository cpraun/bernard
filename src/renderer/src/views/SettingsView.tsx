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
import { useEffect, useState, useCallback, useRef } from 'react'

interface ProviderConfig {
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

interface VectorDbConfig {
  backend?: 'none' | 'lancedb' | 'gemini'
  embeddingProvider?: 'ollama' | 'openai-local'
  ragTopK?: number
  ragMaxDistance?: number
  enabled?: boolean
}

interface AppConfig {
  providers: Record<string, ProviderConfig>
  defaultProvider: string
  vectorDb?: VectorDbConfig
  projectDir?: string
  profileDir?: string
  showSplashScreen?: boolean
  showWelcomePopup?: boolean
  loggingEnabled?: boolean
  theme?: 'light' | 'dark' | 'auto'
  wordExportTemplatePath?: string
}


const PROVIDER_DEFINITIONS = [
  { id: 'anthropic', name: 'Anthropic (cloud)', defaultModel: 'claude-sonnet-4-20250514', notYetImplemented: false },
  { id: 'gemini', name: 'Google Gemini (cloud)', defaultModel: 'gemini-2.5-flash', notYetImplemented: false },
  { id: 'vertex', name: 'Google Enterprise Agent Platform (cloud)', defaultModel: '', notYetImplemented: false },
  { id: 'ollama', name: 'Ollama (local)', defaultModel: 'llama3.2', notYetImplemented: false },
  { id: 'openai-local', name: 'OpenAI-Compatible (local)', defaultModel: '', notYetImplemented: false },
]

const LOCAL_PROVIDERS = new Set(['ollama', 'openai-local'])

const OLLAMA_MODELS = [
  { id: 'gemma3:12b', label: 'Gemma 3 12B' },
  { id: 'gemma3:27b', label: 'Gemma 3 27B' }
]

const GEMINI_MODELS = [
  { id: 'latest', label: 'Latest Gemini Model provided by Google' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview (most intelligent, best reasoning)' },
  { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview (frontier-class intelligence, retires in March 2026)' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview (frontier-class, lower latency)' },
  { id: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro (most capable)' },
  { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash (recommended)' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (fastest)' },
  { id: 'gemini-2.0-flash',      label: 'Gemini 2.0 Flash (retiring Mar 2026)' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite (retiring Mar 2026)' },
]

const ANTHROPIC_MODELS = [
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4 (most capable)' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (recommended)' },
  { id: 'claude-haiku-3-5-20241022', label: 'Claude 3.5 Haiku (fastest)' },
]

interface TestResult {
  success: boolean
  model?: string
  displayName?: string
  inputTokenLimit?: number
  outputTokenLimit?: number
  error?: string
  loading?: boolean
}

interface EmbeddingTestResult {
  success: boolean
  endpoint?: string
  model?: string
  dim?: number
  error?: string
  loading?: boolean
}

interface SettingsViewProps {
  onSettingsChange?: (config: AppConfig) => void
}

function SettingsView({ onSettingsChange }: SettingsViewProps): React.JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})
  const [embeddingTestResults, setEmbeddingTestResults] = useState<Record<string, EmbeddingTestResult>>({})
  const [visibleApiKeys, setVisibleApiKeys] = useState<Set<string>>(new Set())
  const [adcStatus, setAdcStatus] = useState<'unknown' | 'valid' | 'invalid'>('unknown')
  const [adcLoading, setAdcLoading] = useState(false)
  const [providerAvailability, setProviderAvailability] = useState<Record<string, boolean>>({})
  const [appLogContent, setAppLogContent] = useState('')
  const [appLogPanelHeight, setAppLogPanelHeight] = useState(200)
  const [appLogPanelVisible, setAppLogPanelVisible] = useState(false)
  const appLogEndRef = useRef<HTMLDivElement>(null)
  const [openaiLocalModels, setOpenaiLocalModels] = useState<string[]>([])
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([])

  const fetchEmbeddingModels = useCallback(async (providerId: string): Promise<void> => {
    try {
      const models = await window.api.listEmbeddingModels(providerId)
      setEmbeddingModels(models)
    } catch {
      setEmbeddingModels([])
    }
  }, [])

  const fetchOpenaiLocalModels = useCallback(async (): Promise<void> => {
    try {
      const models = await window.api.listOpenaiLocalModels()
      setOpenaiLocalModels(models)
    } catch {
      setOpenaiLocalModels([])
    }
  }, [])

  const refreshAdcStatus = (): void => {
    window.api.checkAdc().then((r) => setAdcStatus(r.valid ? 'valid' : 'invalid'))
  }

  useEffect(() => {
    window.api.getSettings().then((cfg) => {
      setConfig(cfg)
      if (cfg.defaultProvider === 'openai-local') {
        fetchOpenaiLocalModels()
      }
    })
    refreshAdcStatus()
    window.api.checkProviders().then(setProviderAvailability)
  }, [fetchOpenaiLocalModels])

  // Poll app log
  useEffect(() => {
    let active = true
    const poll = async (): Promise<void> => {
      const content = await window.api.readAppLog()
      if (active) setAppLogContent(content)
    }
    poll()
    const interval = setInterval(poll, 2000)
    return () => { active = false; clearInterval(interval) }
  }, [])

  // Auto-scroll app log to bottom
  useEffect(() => {
    appLogEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [appLogContent])

  const handleAppLogResizeStart = useCallback((e: React.MouseEvent): void => {
    const startY = e.clientY
    const startHeight = appLogPanelHeight
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
    const onMove = (ev: MouseEvent): void => {
      const newHeight = Math.max(60, startHeight - (ev.clientY - startY))
      setAppLogPanelHeight(newHeight)
    }
    const onUp = (): void => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [appLogPanelHeight])

  const applyTheme = (theme: 'light' | 'dark' | 'auto' | undefined): void => {
    const effective = theme === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : theme
    if (effective === 'light') {
      document.documentElement.classList.add('light-theme')
    } else {
      document.documentElement.classList.remove('light-theme')
    }
  }

  const updateConfig = (next: AppConfig): void => {
    setConfig(next)
    window.api.updateSettings(next)
    onSettingsChange?.(next)
  }

  const handleApiKeyChange = (providerId: string, apiKey: string): void => {
    if (!config) return
    updateConfig({
      ...config,
      providers: {
        ...config.providers,
        [providerId]: { ...config.providers[providerId], apiKey }
      }
    })
  }

  const handleBaseUrlChange = (providerId: string, baseUrl: string): void => {
    if (!config) return
    updateConfig({
      ...config,
      providers: {
        ...config.providers,
        [providerId]: { ...config.providers[providerId], baseUrl: baseUrl || undefined }
      }
    })
  }

  const handleModelChange = (providerId: string, model: string): void => {
    if (!config) return
    updateConfig({
      ...config,
      providers: {
        ...config.providers,
        [providerId]: { ...config.providers[providerId], model: model || undefined }
      }
    })
  }

  const handleGenParamChange = (providerId: string, param: 'temperature' | 'topK' | 'topP' | 'maxOutputTokens' | 'ragTopK' | 'ragMaxDistance', value: number): void => {
    if (!config) return
    updateConfig({
      ...config,
      providers: {
        ...config.providers,
        [providerId]: { ...config.providers[providerId], [param]: value }
      }
    })
  }

  const handleDefaultProviderChange = (providerId: string): void => {
    if (!config) return
    updateConfig({ ...config, defaultProvider: providerId })
    if (providerId === 'openai-local') {
      fetchOpenaiLocalModels()
    }
  }

  const handleTest = async (providerId: string): Promise<void> => {
    // Save first so the test uses current values
    if (config) await window.api.updateSettings(config)
    setTestResults((prev) => ({ ...prev, [providerId]: { success: true, loading: true } }))
    const result = await window.api.testProvider(providerId)
    setTestResults((prev) => ({ ...prev, [providerId]: result }))
    // Refresh availability after test
    window.api.checkProviders().then(setProviderAvailability)
    if (providerId === 'openai-local' && result.success) {
      fetchOpenaiLocalModels()
    }
  }

  const handleTestEmbeddings = async (providerId: string): Promise<void> => {
    if (config) await window.api.updateSettings(config)
    setEmbeddingTestResults((prev) => ({ ...prev, [providerId]: { success: true, loading: true } }))
    const result = await window.api.testEmbeddings(providerId)
    setEmbeddingTestResults((prev) => ({ ...prev, [providerId]: result }))
  }

  const handleBrowseProjectDir = async (): Promise<void> => {
    const selected = await window.api.selectDirectory()
    if (selected && config) {
      updateConfig({ ...config, projectDir: selected })
    }
  }

  const handleBrowseProfileDir = async (): Promise<void> => {
    const selected = await window.api.selectDirectory()
    if (selected && config) {
      updateConfig({ ...config, profileDir: selected })
    }
  }

  if (!config) return <div className="settings-loading">Loading settings...</div>

  return (
    <div className="settings-tab">
      <div className="settings-content">
          <div className="settings-section">
            <h3>AI Providers</h3>
            <p className="settings-hint">
              Configure API keys for the AI providers you want to use.
            </p>

            {PROVIDER_DEFINITIONS.map((def) => {
              const providerConfig = config.providers[def.id] || { apiKey: '' }
              const isDefault = config.defaultProvider === def.id
              const isAvailable = providerAvailability[def.id] !== false

              return (
                <div
                  key={def.id}
                  className={`provider-card ${isDefault ? 'selected' : ''}${!isDefault && !isAvailable ? ' unavailable' : ''}`}
                  style={def.notYetImplemented ? { opacity: 0.45, pointerEvents: 'none' } : undefined}
                  onClick={() => { if (!def.notYetImplemented) handleDefaultProviderChange(def.id) }}
                >
                  <div className="provider-card-header">
                    <span className="provider-name">{def.name}</span>
                    {def.notYetImplemented && (
                      <span className="provider-not-implemented">not yet implemented</span>
                    )}
                  </div>

                  {isDefault && (
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                  <div onClick={(e) => e.stopPropagation()}>
                  {LOCAL_PROVIDERS.has(def.id) ? (
                    <div className="provider-field">
                      <label>Server URL</label>
                      <input
                        type="text"
                        className="settings-input"
                        placeholder={def.id === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234/v1'}
                        value={providerConfig.baseUrl || ''}
                        onChange={(e) => handleBaseUrlChange(def.id, e.target.value)}
                      />
                    </div>
                  ) : def.id === 'vertex' ? (
                    <>
                      <div className="provider-field">
                        <label>GCP Project ID</label>
                        <input
                          type="text"
                          className="settings-input"
                          placeholder="my-gcp-project"
                          value={providerConfig.projectId || ''}
                          onChange={(e) => {
                            if (!config) return
                            updateConfig({ ...config, providers: { ...config.providers, [def.id]: { ...providerConfig, projectId: e.target.value || undefined } } })
                          }}
                        />
                      </div>
                      <div className="provider-field">
                        <label>Region</label>
                        <input
                          type="text"
                          className="settings-input"
                          placeholder="us-central1"
                          value={providerConfig.region || ''}
                          onChange={(e) => {
                            if (!config) return
                            updateConfig({ ...config, providers: { ...config.providers, [def.id]: { ...providerConfig, region: e.target.value || undefined } } })
                          }}
                        />
                      </div>
                      <div className="provider-field">
                        <label>Endpoint ID</label>
                        <input
                          type="text"
                          className="settings-input"
                          placeholder="1234567890123456789"
                          value={providerConfig.endpointId || ''}
                          onChange={(e) => {
                            if (!config) return
                            updateConfig({ ...config, providers: { ...config.providers, [def.id]: { ...providerConfig, endpointId: e.target.value || undefined } } })
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: adcStatus === 'valid' ? '#22c55e' : adcStatus === 'invalid' ? '#ef4444' : '#71717a',
                            flexShrink: 0
                          }}
                        />
                        <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>
                          {adcStatus === 'valid' ? 'ADC credentials found' : adcStatus === 'invalid' ? 'No ADC credentials' : 'Checking…'}
                        </span>
                        <button
                          className="test-button"
                          style={{ marginLeft: 'auto' }}
                          disabled={adcLoading}
                          onClick={async () => {
                            setAdcLoading(true)
                            const result = await window.api.loginGoogle()
                            setAdcLoading(false)
                            if (result.success) {
                              refreshAdcStatus()
                            }
                          }}
                        >
                          {adcLoading ? 'Signing in…' : 'Sign In with Google'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="provider-field">
                      <label>API Key{def.id === 'gemini' ? ' (Cloud Vision API and Generative Language API)' : ''}</label>
                      <div className="api-key-wrapper">
                        <input
                          type={visibleApiKeys.has(def.id) ? 'text' : 'password'}
                          className="settings-input"
                          placeholder="Enter API key..."
                          value={providerConfig.apiKey || ''}
                          onChange={(e) => handleApiKeyChange(def.id, e.target.value)}
                        />
                        <button
                          className="api-key-toggle"
                          type="button"
                          onClick={() => setVisibleApiKeys((prev) => {
                            const next = new Set(prev)
                            if (next.has(def.id)) next.delete(def.id)
                            else next.add(def.id)
                            return next
                          })}
                          title={visibleApiKeys.has(def.id) ? 'Hide API key' : 'Show API key'}
                        >
                          {visibleApiKeys.has(def.id) ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                              <line x1="1" y1="1" x2="23" y2="23" />
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {def.id === 'openai-local' && (
                    <>
                      <div className="provider-field">
                        <label>Model</label>
                        <select
                          className="settings-input"
                          value={providerConfig.model || ''}
                          onChange={(e) => handleModelChange(def.id, e.target.value)}
                          onMouseDown={() => fetchOpenaiLocalModels()}
                        >
                          {openaiLocalModels.length === 0 && (
                            <option value="">— Click here to select a model —</option>
                          )}
                          {openaiLocalModels.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                      <div className="provider-field">
                        <label>Temperature <span className="param-value">{(providerConfig.temperature ?? 1.0).toFixed(2)}</span></label>
                        <input
                          type="range"
                          min={0} max={2} step={0.01}
                          value={providerConfig.temperature ?? 1.0}
                          onChange={(e) => handleGenParamChange(def.id, 'temperature', parseFloat(e.target.value))}
                        />
                      </div>
                      <div className="provider-field">
                        <label>Top P <span className="param-value">{(providerConfig.topP ?? 1.0).toFixed(2)}</span></label>
                        <input
                          type="range"
                          min={0} max={1} step={0.01}
                          value={providerConfig.topP ?? 1.0}
                          onChange={(e) => handleGenParamChange(def.id, 'topP', parseFloat(e.target.value))}
                        />
                      </div>
                      <div className="provider-field">
                        <label>Max Output Tokens <span className="param-value">{providerConfig.maxOutputTokens ?? 8192}</span></label>
                        <input
                          type="range"
                          min={256} max={32768} step={256}
                          value={providerConfig.maxOutputTokens ?? 8192}
                          onChange={(e) => handleGenParamChange(def.id, 'maxOutputTokens', parseInt(e.target.value))}
                        />
                      </div>
                      <div className="provider-field">
                        <label>Reasoning Effort</label>
                        <select
                          className="settings-input"
                          value={providerConfig.reasoningEffort ?? ''}
                          onChange={(e) => {
                            if (!config) return
                            const val = e.target.value as 'low' | 'medium' | 'high' | ''
                            const updated = { ...providerConfig }
                            if (val) updated.reasoningEffort = val
                            else delete updated.reasoningEffort
                            updateConfig({ ...config, providers: { ...config.providers, [def.id]: updated } })
                          }}
                        >
                          <option value="">— Not specified —</option>
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                      </div>
                    </>
                  )}

                  {def.id !== 'openai-local' && def.id !== 'vertex' && <div className="provider-field">
                    <label>Model</label>
                    {def.id === 'gemini' ? (
                      <select
                        className="settings-input"
                        value={providerConfig.model || 'gemini-2.5-flash'}
                        onChange={(e) => handleModelChange(def.id, e.target.value)}
                      >
                        {GEMINI_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </select>
                    ) : def.id === 'anthropic' ? (
                      <select
                        className="settings-input"
                        value={providerConfig.model || 'claude-sonnet-4-20250514'}
                        onChange={(e) => handleModelChange(def.id, e.target.value)}
                      >
                        {ANTHROPIC_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </select>
                    ) : def.id === 'ollama' ? (
                      <>
                        <select
                          className="settings-input"
                          value={OLLAMA_MODELS.some((m) => m.id === providerConfig.model) ? providerConfig.model : '__custom__'}
                          onChange={(e) => {
                            if (e.target.value !== '__custom__') handleModelChange(def.id, e.target.value)
                            else handleModelChange(def.id, '')
                          }}
                        >
                          {OLLAMA_MODELS.map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                          <option value="__custom__">Custom…</option>
                        </select>
                        {!OLLAMA_MODELS.some((m) => m.id === providerConfig.model) && (
                          <input
                            type="text"
                            className="settings-input"
                            style={{ marginTop: 6 }}
                            placeholder={def.defaultModel}
                            value={providerConfig.model || ''}
                            onChange={(e) => handleModelChange(def.id, e.target.value)}
                          />
                        )}
                      </>
                    ) : (
                      <input
                        type="text"
                        className="settings-input"
                        placeholder={def.defaultModel}
                        value={providerConfig.model || ''}
                        onChange={(e) => handleModelChange(def.id, e.target.value)}
                      />
                    )}
                  </div>}

                  {def.id === 'gemini' && (
                    <>
                      <div className="provider-field">
                        <label>Temperature <span className="param-value">{(providerConfig.temperature ?? 1.0).toFixed(2)}</span></label>
                        <input
                          type="range"
                          min={0} max={2} step={0.01}
                          value={providerConfig.temperature ?? 1.0}
                          onChange={(e) => handleGenParamChange(def.id, 'temperature', parseFloat(e.target.value))}
                        />
                      </div>
                      <div className="provider-field">
                        <label>Top K <span className="param-value">{providerConfig.topK ?? 40}</span></label>
                        <input
                          type="range"
                          min={1} max={100} step={1}
                          value={providerConfig.topK ?? 40}
                          onChange={(e) => handleGenParamChange(def.id, 'topK', parseInt(e.target.value))}
                        />
                      </div>
                      <div className="provider-field">
                        <label>Max Output Tokens <span className="param-value">{providerConfig.maxOutputTokens ?? 8192}</span></label>
                        <input
                          type="range"
                          min={1024} max={65536} step={1024}
                          value={providerConfig.maxOutputTokens ?? 8192}
                          onChange={(e) => handleGenParamChange(def.id, 'maxOutputTokens', parseInt(e.target.value))}
                        />
                      </div>
                    </>
                  )}

                  {def.id === 'anthropic' && (
                    <>
                      <div className="provider-field">
                        <label>Temperature <span className="param-value">{(providerConfig.temperature ?? 1.0).toFixed(2)}</span></label>
                        <input
                          type="range"
                          min={0} max={1} step={0.01}
                          value={providerConfig.temperature ?? 1.0}
                          onChange={(e) => handleGenParamChange(def.id, 'temperature', parseFloat(e.target.value))}
                        />
                      </div>
                      <div className="provider-field">
                        <label>Max Output Tokens <span className="param-value">{providerConfig.maxOutputTokens ?? 8192}</span></label>
                        <input
                          type="range"
                          min={1024} max={65536} step={1024}
                          value={providerConfig.maxOutputTokens ?? 8192}
                          onChange={(e) => handleGenParamChange(def.id, 'maxOutputTokens', parseInt(e.target.value))}
                        />
                      </div>
                    </>
                  )}

                  {def.id === 'vertex' && (
                    <>
                      <div className="provider-field">
                        <label>Temperature <span className="param-value">{(providerConfig.temperature ?? 1.0).toFixed(2)}</span></label>
                        <input
                          type="range"
                          min={0} max={2} step={0.01}
                          value={providerConfig.temperature ?? 1.0}
                          onChange={(e) => handleGenParamChange(def.id, 'temperature', parseFloat(e.target.value))}
                        />
                      </div>
                      <div className="provider-field">
                        <label>Top P <span className="param-value">{(providerConfig.topP ?? 0.95).toFixed(2)}</span></label>
                        <input
                          type="range"
                          min={0} max={1} step={0.01}
                          value={providerConfig.topP ?? 0.95}
                          onChange={(e) => handleGenParamChange(def.id, 'topP', parseFloat(e.target.value))}
                        />
                      </div>
                      <div className="provider-field">
                        <label>Top K <span className="param-value">{providerConfig.topK ?? 40}</span></label>
                        <input
                          type="range"
                          min={1} max={100} step={1}
                          value={providerConfig.topK ?? 40}
                          onChange={(e) => handleGenParamChange(def.id, 'topK', parseInt(e.target.value))}
                        />
                      </div>
                      <div className="provider-field">
                        <label>Max Output Tokens <span className="param-value">{providerConfig.maxOutputTokens ?? 8192}</span></label>
                        <input
                          type="range"
                          min={1024} max={65536} step={1024}
                          value={providerConfig.maxOutputTokens ?? 8192}
                          onChange={(e) => handleGenParamChange(def.id, 'maxOutputTokens', parseInt(e.target.value))}
                        />
                      </div>
                      <div className="provider-field">
                        <label>Stop Sequences</label>
                        <input
                          type="text"
                          className="settings-input"
                          placeholder="Comma-separated (e.g. </s>,<|eot|>)"
                          value={(providerConfig.stop ?? []).join(', ')}
                          onChange={(e) => {
                            if (!config) return
                            const stop = e.target.value ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : undefined
                            updateConfig({ ...config, providers: { ...config.providers, [def.id]: { ...providerConfig, stop } } })
                          }}
                        />
                      </div>
                    </>
                  )}

                  <div className="provider-actions">
                    <button
                      className="test-button"
                      onClick={() => handleTest(def.id)}
                      disabled={
                        def.id === 'vertex'
                          ? !providerConfig.endpointId
                          : LOCAL_PROVIDERS.has(def.id)
                            ? false
                            : !providerConfig.apiKey
                      }
                    >
                      Test Chat
                    </button>
                    {testResults[def.id]?.loading && (
                      <svg style={{ animation: 'statusbar-spin 0.7s linear infinite', flexShrink: 0 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                      </svg>
                    )}
                    {testResults[def.id] && !testResults[def.id].loading && (
                      <span className={`test-result ${testResults[def.id].success ? 'success' : 'error'}`}>
                        {testResults[def.id].success ? (
                          <>
                            Connected — {(() => {
                              const display = testResults[def.id].displayName ?? testResults[def.id].model ?? ''
                              if (display.includes('No models deployed')) {
                                const parts = display.split(/(No models deployed)/)
                                return parts.map((part, i) =>
                                  part === 'No models deployed'
                                    ? <span key={i} style={{ color: '#ef4444' }}>{part}</span>
                                    : part
                                )
                              }
                              return display
                            })()}
                            {testResults[def.id].inputTokenLimit && (
                              <span className="test-model-info">
                                ctx {testResults[def.id].inputTokenLimit!.toLocaleString()} · out {testResults[def.id].outputTokenLimit?.toLocaleString() ?? '—'}
                              </span>
                            )}
                          </>
                        ) : `Failed: ${testResults[def.id].error}`}
                      </span>
                    )}
                  </div>
                  </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="settings-section">
            <h3>Vector DB</h3>
            <p className="settings-hint">
              Vector database for RAG (Retrieval-Augmented Generation). Select one or none.
            </p>

            {(['gemini', 'lancedb'] as const).map((backend) => {
              const activeBackend = config.vectorDb?.backend ?? (config.vectorDb?.enabled !== false ? 'lancedb' : 'none')
              const isActive = activeBackend === backend
              const label = backend === 'lancedb' ? 'LanceDB (local)' : 'Google Gemini File Search (cloud)'

              return (
                <div
                  key={backend}
                  className={`provider-card ${isActive ? 'selected' : ''}`}
                  onClick={() => {
                    const current = config.vectorDb ?? {}
                    updateConfig({ ...config, vectorDb: { ...current, backend: isActive ? 'none' : backend } })
                  }}
                >
                  <div className="provider-card-header">
                    <span className="provider-name">{label}</span>
                  </div>

                  {backend === 'lancedb' && isActive && (
                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                    <div onClick={(e) => e.stopPropagation()}>
                      <div className="provider-field">
                        <label>Embedding Provider</label>
                        <select
                          className="settings-select"
                          value={config.vectorDb?.embeddingProvider ?? 'ollama'}
                          onChange={(e) => {
                            const current = config.vectorDb ?? {}
                            const newProvider = e.target.value as 'ollama' | 'openai-local'
                            updateConfig({ ...config, vectorDb: { ...current, embeddingProvider: newProvider } })
                            setEmbeddingModels([])
                          }}
                        >
                          <option value="ollama">Ollama (local)</option>
                          <option value="openai-local">OpenAI-Compatible (local)</option>
                        </select>
                      </div>
                      <div className="provider-field">
                        <label>Embedding Model</label>
                        <select
                          className="settings-select"
                          value={config.providers[config.vectorDb?.embeddingProvider ?? 'ollama']?.embeddingModel || ''}
                          onChange={(e) => {
                            const provId = config.vectorDb?.embeddingProvider ?? 'ollama'
                            const current = config.providers[provId] ?? {}
                            updateConfig({ ...config, providers: { ...config.providers, [provId]: { ...current, embeddingModel: e.target.value } } })
                          }}
                          onMouseDown={() => fetchEmbeddingModels(config.vectorDb?.embeddingProvider ?? 'ollama')}
                        >
                          {embeddingModels.length === 0 && (
                            <option value="">— Click here to select a model —</option>
                          )}
                          {embeddingModels.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                      <div className="provider-actions">
                        <button
                          className="test-button"
                          onClick={() => handleTestEmbeddings(config.vectorDb?.embeddingProvider ?? 'ollama')}
                        >
                          Test Embeddings
                        </button>
                        {embeddingTestResults[config.vectorDb?.embeddingProvider ?? 'ollama'] && (
                          <span className={`test-result ${embeddingTestResults[config.vectorDb?.embeddingProvider ?? 'ollama'].loading ? '' : embeddingTestResults[config.vectorDb?.embeddingProvider ?? 'ollama'].success ? 'success' : 'error'}`}>
                            {embeddingTestResults[config.vectorDb?.embeddingProvider ?? 'ollama'].loading ? 'Testing…' : embeddingTestResults[config.vectorDb?.embeddingProvider ?? 'ollama'].success ? (
                              <>
                                Connected — {embeddingTestResults[config.vectorDb?.embeddingProvider ?? 'ollama'].model}
                              </>
                            ) : `Failed: ${embeddingTestResults[config.vectorDb?.embeddingProvider ?? 'ollama'].error}`}
                          </span>
                        )}
                      </div>
                      <div> <br></br></div>
                      <div className="provider-field">
                        <label>RAG Top K <span className="param-value">{config.vectorDb?.ragTopK ?? 5}</span></label>
                        <input
                          type="range"
                          min={0} max={20} step={1}
                          value={config.vectorDb?.ragTopK ?? 5}
                          onChange={(e) => {
                            const current = config.vectorDb ?? {}
                            updateConfig({ ...config, vectorDb: { ...current, ragTopK: parseInt(e.target.value) } })
                          }}
                        />
                      </div>
                      <div className="provider-field">
                        <label>RAG Max Distance <span className="param-value">{(config.vectorDb?.ragMaxDistance ?? 1.0).toFixed(2)}</span></label>
                        <input
                          type="range"
                          min={0.1} max={3.0} step={0.05}
                          value={config.vectorDb?.ragMaxDistance ?? 1.0}
                          onChange={(e) => {
                            const current = config.vectorDb ?? {}
                            updateConfig({ ...config, vectorDb: { ...current, ragMaxDistance: parseFloat(e.target.value) } })
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="settings-section">
            <h3>Directories</h3>
            <div className="provider-field">
              <label>Base</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="settings-input"
                  value="~/.bernard"
                  readOnly
                />
              </div>
            </div>
            <div className="provider-field">
              <label>Projects</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="settings-input"
                  value={config.projectDir || '~/.bernard/projects'}
                  readOnly
                />
                <button className="test-button" onClick={handleBrowseProjectDir}>
                  Browse
                </button>
              </div>
            </div>
            <div className="provider-field">
              <label>Profile</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="settings-input"
                  value={config.profileDir || '~/.bernard/demo-profile'}
                  readOnly
                />
                <button className="test-button" onClick={handleBrowseProfileDir}>
                  Browse
                </button>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h3>Logging</h3>
            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={config.loggingEnabled !== false}
                onChange={(e) => updateConfig({ ...config, loggingEnabled: e.target.checked })}
              />
              Enable per-chat interaction logging
            </label>
          </div>

          <div className="settings-section">
            <h3>Word Export</h3>
            <p className="settings-hint">
              Optionally specify a .docx template file. Its styles (fonts, headings, spacing)
              will be applied to exported Word documents.
            </p>
            <div className="provider-field">
              <label>Template</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="settings-input"
                  value={config.wordExportTemplatePath || 'No template selected'}
                  readOnly
                />
                <button className="test-button" onClick={async () => {
                  const selected = await window.api.selectFile(undefined, [{ name: 'Word Document', extensions: ['docx'] }])
                  if (selected) {
                    updateConfig({ ...config, wordExportTemplatePath: selected })
                  }
                }}>Browse</button>
                {config.wordExportTemplatePath && (
                  <button className="test-button" onClick={() => {
                    const { wordExportTemplatePath: _, ...rest } = config
                    updateConfig({ ...rest, wordExportTemplatePath: undefined } as typeof config)
                  }}>Clear</button>
                )}
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h3>Appearance</h3>
            <div className="theme-toggle-group">
              <button
                className={`theme-toggle-button ${(config.theme ?? 'dark') === 'dark' ? 'active' : ''}`}
                onClick={() => { applyTheme('dark'); updateConfig({ ...config, theme: 'dark' }) }}
              >
                Dark
              </button>
              <button
                className={`theme-toggle-button ${config.theme === 'light' ? 'active' : ''}`}
                onClick={() => { applyTheme('light'); updateConfig({ ...config, theme: 'light' }) }}
              >
                Light
              </button>
              <button
                className={`theme-toggle-button ${config.theme === 'auto' ? 'active' : ''}`}
                onClick={() => { applyTheme('auto'); updateConfig({ ...config, theme: 'auto' }) }}
              >
                Auto
              </button>
            </div>
            <label className="settings-checkbox-label" style={{ marginTop: 12 }}>
              <input
                type="checkbox"
                checked={config.showSplashScreen !== false}
                onChange={(e) => {
                  const checked = e.target.checked
                  const update: Partial<AppConfig> = { showSplashScreen: checked }
                  if (checked) update.showWelcomePopup = true
                  updateConfig({ ...config, ...update })
                }}
              />
              Show splash screen on startup
            </label>
          </div>

      </div>
      <div className="mcp-log-resize-handle" onMouseDown={handleAppLogResizeStart} />
      <div className="mcp-log-panel" style={{ height: appLogPanelVisible ? appLogPanelHeight : 28 }}>
        <div
          className="mcp-log-header"
          onClick={() => setAppLogPanelVisible(!appLogPanelVisible)}
        >
          <span>Application Log</span>
          <span style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              className="test-button"
              style={{ fontSize: '0.7rem', padding: '1px 8px' }}
              onClick={(e) => { e.stopPropagation(); window.api.clearAppLog().then(() => setAppLogContent('')) }}
            >
              Clear
            </button>
            <span className="mcp-log-toggle">{appLogPanelVisible ? '\u25BC' : '\u25B2'}</span>
          </span>
        </div>
        {appLogPanelVisible && (
          <pre className="mcp-log-content">
            {appLogContent || '(no log output)'}
            <div ref={appLogEndRef} />
          </pre>
        )}
      </div>
    </div>
  )
}

export default SettingsView
