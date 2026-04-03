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
import { useCallback, useEffect, useRef, useState } from 'react'
import { prepareCommandPrompt } from './utils/commandPrompt'
import type { Message, Conversation } from './types/chat'
import MessageList from './components/MessageList'
import ChatInput from './components/ChatInput'
import ContextPanel, { type ContextFile } from './components/ContextPanel'
import SkillsPanel from './components/SkillsPanel'
import SplashScreen from './components/SplashScreen'
import WelcomePopup from './components/WelcomePopup'
import SettingsView from './views/SettingsView'
import SkillsTabView from './views/SkillsTabView'
import CommandsTabView from './views/CommandsTabView'
import PersonasTabView from './views/PersonasTabView'
import ToolsTabView from './views/ToolsTabView'
import infoHtml from './assets/info.html?raw'

interface Project {
  id: string
  name: string
  description?: string
  source?: 'manual' | 'directory'
  createdAt: number
  updatedAt: number
}

let messageCounter = 0
function generateId(): string {
  return `msg-${Date.now()}-${++messageCounter}`
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
}

type AppTab = 'chat' | 'personas' | 'commands' | 'skills' | 'tools' | 'settings' | 'info'

function createTrashDragImage(): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:#ef4444;border-radius:6px;'
  el.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>'
  document.body.appendChild(el)
  return el
}

function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<AppTab>('chat')
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null)
  const [conversationList, setConversationList] = useState<Conversation[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [contextFiles, setContextFiles] = useState<ContextFile[]>([])
  const [showSkillsPanel, setShowSkillsPanel] = useState(false)
  const [contextPanelHeight, setContextPanelHeight] = useState(160)
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [chatPrefill, setChatPrefill] = useState('')
  const [clearInputSignal, setClearInputSignal] = useState(0)
  const [chatDraft, setChatDraft] = useState('')
  const [activeCommandFilename, setActiveCommandFilename] = useState<string | null>(null)
  const [providerInfo, setProviderInfo] = useState<{ id: string; name: string; model: string; vectorDb: string } | null>(null)
  const [availableProviders, setAvailableProviders] = useState<Record<string, boolean>>({})
  const [lastUsage, setLastUsage] = useState<{ promptTokens: number; completionTokens: number } | null>(null)
  const [totalCompletionTokens, setTotalCompletionTokens] = useState(0)
  const convTokenData = useRef<Map<string, { lastUsage: { promptTokens: number; completionTokens: number } | null; totalCompletionTokens: number }>>(new Map())
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [showSplash, setShowSplash] = useState(true)
  const [splashFading, setSplashFading] = useState(false)
  const [splashStatus, setSplashStatus] = useState('Starting...')
  const [showWelcome, setShowWelcome] = useState(false)
  const [sessionContext, setSessionContext] = useState<{ role: string; content: string }[]>([])
  const [activePersonaFilename, setActivePersonaFilename] = useState<string | null>(
    () => localStorage.getItem('activePersonaFilename')
  )
  const [activePersonaContent, setActivePersonaContent] = useState<string | null>(null)
  const [personasList, setPersonasList] = useState<{ filename: string; name: string; content: string }[]>([])
  const [loggingEnabled, setLoggingEnabled] = useState(true)
  const [messageLogIds, setMessageLogIds] = useState<Set<string>>(new Set())
  const [selectedToolFilenames, setSelectedToolFilenames] = useState<Set<string>>(new Set())
  const [conditionalToolFilenames, setConditionalToolFilenames] = useState<Set<string>>(new Set())
  const [uiStateLoaded, setUIStateLoaded] = useState(false)
  const uiPanelSizes = useRef<{ chatSidebar?: number; personasSidebar?: number; commandsSidebar?: number; skillsSidebar?: number; toolsSidebar?: number; contextPanelHeight?: number; chatInputHeight?: number }>({})
  const uiCollapsedMCPServers = useRef<string[] | undefined>(undefined)
  const uiCollapsedSkillDirs = useRef<string[] | undefined>(undefined)
  const splashTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const convDragDropHandled = useRef(false)
  const fileDragDropHandled = useRef(false)
  const shouldDeselectChat = useRef(false)

  // Splash screen: show until initialization completes (or safety timeout)
  useEffect(() => {
    const mountTime = Date.now()
    const MIN_DISPLAY_MS = 3000
    let dismissed = false

    function dismissSplash(): void {
      if (dismissed) return
      dismissed = true
      const elapsed = Date.now() - mountTime
      const delay = Math.max(0, MIN_DISPLAY_MS - elapsed)
      const fadeTimer = setTimeout(() => setSplashFading(true), delay)
      const hideTimer = setTimeout(() => setShowSplash(false), delay + 600)
      splashTimers.current = [fadeTimer, hideTimer]
    }

    window.api.getSettings().then((s) => {
      const effective = s.theme === 'auto'
        ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : s.theme
      if (effective === 'light') {
        document.documentElement.classList.add('light-theme')
      }
      if (s.theme === 'auto') {
        const mq = window.matchMedia('(prefers-color-scheme: light)')
        mq.addEventListener('change', (e) => {
          if (e.matches) {
            document.documentElement.classList.add('light-theme')
          } else {
            document.documentElement.classList.remove('light-theme')
          }
        })
      }
      if (s.showSplashScreen === false) {
        setShowSplash(false)
        dismissed = true
      }
      if (s.showWelcomePopup !== false) {
        setShowWelcome(true)
      }
    })

    // Listen for init status from main process
    const unsub = window.api.onInitStatus((msg) => {
      setSplashStatus(msg)
      if (msg === 'Ready') dismissSplash()
    })
    // Signal to main process that the listener is ready
    window.api.signalRendererReady()

    // ESC key skips remaining MCP server connections during startup
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !dismissed) {
        window.api.abortInit()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    // Safety timeout: dismiss after 15s even if Ready never arrives
    const safetyTimer = setTimeout(dismissSplash, 15000)
    splashTimers.current.push(safetyTimer)

    return () => {
      unsub()
      window.removeEventListener('keydown', onKeyDown)
      splashTimers.current.forEach(clearTimeout)
    }
  }, [])

  // Restore UI state (selected tools + panel sizes) on mount
  useEffect(() => {
    window.api.getUIState().then((s) => {
      if (s.selectedTools?.length) {
        setSelectedToolFilenames(new Set(s.selectedTools))
      }
      if (s.conditionalTools?.length) {
        setConditionalToolFilenames(new Set(s.conditionalTools))
      }
      if (s.panelSizes) {
        uiPanelSizes.current = s.panelSizes
        if (s.panelSizes.chatSidebar) setSidebarWidth(s.panelSizes.chatSidebar)
        if (s.panelSizes.contextPanelHeight) setContextPanelHeight(s.panelSizes.contextPanelHeight)
      }
      if (s.collapsedMCPServers) uiCollapsedMCPServers.current = s.collapsedMCPServers
      if (s.collapsedSkillDirs) uiCollapsedSkillDirs.current = s.collapsedSkillDirs
      setUIStateLoaded(true)
    })
  }, [])

  // Persist selected tools whenever they change
  const selectedToolsInitialized = useRef(false)
  useEffect(() => {
    if (!uiStateLoaded) return
    if (!selectedToolsInitialized.current) {
      selectedToolsInitialized.current = true
      return
    }
    window.api.patchUIState({ selectedTools: [...selectedToolFilenames], conditionalTools: [...conditionalToolFilenames] })
  }, [selectedToolFilenames, conditionalToolFilenames, uiStateLoaded])

  // Initialize: ensure default project, load projects and conversations
  useEffect(() => {
    const init = async (): Promise<void> => {
      const projectId = await window.api.ensureDefaultProject()
      setActiveProjectId(projectId)
      const projectList = await window.api.listProjects()
      setProjects(projectList)
      const convList = await window.api.listConversations(projectId)
      setConversationList(convList)
      const files = await window.api.listProjectFiles(projectId)
      setContextFiles(files.map((f) => ({ ...f, selected: false })))
      await window.api.watchProject(projectId)
    }
    init()

    const unsubscribe = window.api.onProjectsChanged((updatedProjects) => {
      setProjects(updatedProjects)
    })
    return () => unsubscribe()
  }, [])

  // Watch project directory for external file changes and refresh context panel
  useEffect(() => {
    const unsub = window.api.onProjectFilesChanged(() => {
      if (!activeProjectId) return
      window.api.listProjectFiles(activeProjectId).then((files) => {
        setContextFiles((prev) => {
          const prevByName = new Map(prev.map((f) => [f.filename, f]))
          return files.map((f) => ({
            ...f,
            selected: prevByName.get(f.filename)?.selected ?? false
          }))
        })
      })
    })
    return () => unsub()
  }, [activeProjectId])

  // Reload provider info on mount and whenever the active tab changes.
  // When switching to the chat tab with an active conversation, restore
  // the conversation's provider/vectorDb so the status bar and settings
  // reflect what the conversation was created with.
  useEffect(() => {
    window.api.getSettings().then(async (s) => {
      // If returning to the chat tab with an active conversation, restore its provider
      if (activeTab === 'chat' && currentConversation) {
        let settingsChanged = false
        if (currentConversation.providerId && s.providers[currentConversation.providerId]?.enabled !== false) {
          if (s.defaultProvider !== currentConversation.providerId) {
            s.defaultProvider = currentConversation.providerId
            settingsChanged = true
          }
        }
        if (currentConversation.vectorDbBackend !== undefined) {
          const currentBackend = s.vectorDb?.backend ?? (s.vectorDb?.enabled !== false ? 'lancedb' : 'none')
          if (currentBackend !== currentConversation.vectorDbBackend) {
            s.vectorDb = { ...s.vectorDb, backend: currentConversation.vectorDbBackend as 'none' | 'lancedb' | 'gemini' }
            settingsChanged = true
          }
        }
        if (settingsChanged) {
          await window.api.updateSettings(s)
        }
      }

      const pid = s.defaultProvider
      const pcfg = s.providers[pid]
      const vdb = s.vectorDb?.backend ?? (s.vectorDb?.enabled !== false ? 'lancedb' : 'none')
      setProviderInfo({
        id: pid,
        name: pid.charAt(0).toUpperCase() + pid.slice(1),
        model: pcfg?.model ?? '',
        vectorDb: vdb === 'lancedb' ? 'LanceDB' : vdb === 'gemini' ? 'Gemini File Search' : 'none'
      })
      setLoggingEnabled(s.loggingEnabled !== false)
      window.api.checkProviders().then(setAvailableProviders)
      window.api.listPersonas().then((list) => setPersonasList(list.map((p) => ({ filename: p.filename, name: p.name, content: p.content }))))
    })
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // When switching back to the Chat tab, sync the persona selection
  // to match the persona of the currently active conversation
  useEffect(() => {
    if (activeTab !== 'chat' || !currentConversation) return
    const chatPersona = currentConversation.personaFilename ?? null
    if (chatPersona !== activePersonaFilename) {
      setActivePersonaFilename(chatPersona)
      if (chatPersona) {
        localStorage.setItem('activePersonaFilename', chatPersona)
        window.api.listPersonas().then((list) => {
          const found = list.find((p) => p.filename === chatPersona)
          setActivePersonaContent(found?.content ?? null)
        })
      } else {
        localStorage.removeItem('activePersonaFilename')
        setActivePersonaContent(null)
      }
    }
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Restore active persona content from the personas list on mount
  useEffect(() => {
    if (!activePersonaFilename) return
    window.api.listPersonas().then((list) => {
      const found = list.find((p) => p.filename === activePersonaFilename)
      if (found) {
        setActivePersonaContent(found.content)
      } else {
        // File no longer exists — clear the stale selection
        setActivePersonaFilename(null)
        setActivePersonaContent(null)
        localStorage.removeItem('activePersonaFilename')
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to File Store sync progress events
  useEffect(() => {
    let clearTimer: ReturnType<typeof setTimeout> | null = null
    const unsub = window.api.onSyncStatus((msg: string) => {
      setSyncStatus(msg)
      if (clearTimer !== null) clearTimeout(clearTimer)
      if (msg.startsWith('Sync complete') || msg.startsWith('OCR complete')) {
        clearTimer = setTimeout(() => setSyncStatus(null), 3000)
      }
    })
    return () => {
      unsub()
      if (clearTimer !== null) clearTimeout(clearTimer)
    }
  }, [])

  // ESC key cancels the current AI request while loading
  useEffect(() => {
    if (!isLoading) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.api.abortMessage()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isLoading])

  const refreshConversations = useCallback(async (projectId: string) => {
    const list = await window.api.listConversations(projectId)
    setConversationList(list)
  }, [])

  const persistConversation = useCallback(
    async (conv: Conversation, msgs: Message[]) => {
      if (!activeProjectId) return
      const updated = { ...conv, messages: msgs, updatedAt: Date.now() }
      await window.api.saveConversation(activeProjectId, updated)
      setCurrentConversation(updated)
      await refreshConversations(activeProjectId)
    },
    [activeProjectId, refreshConversations]
  )

  const handleSwitchProject = async (projectId: string): Promise<void> => {
    setActiveProjectId(projectId)
    await window.api.setActiveProject(projectId)
    setMessages([])
    setCurrentConversation(null)
    setSessionContext([])
    const files = await window.api.listProjectFiles(projectId)
    setContextFiles(files.map((f) => ({ ...f, selected: false })))
    await window.api.watchProject(projectId)
    await refreshConversations(projectId)
  }

  const handleCreateProject = async (): Promise<void> => {
    const result = await window.api.selectProjectDirectory()
    if (!result) return
    if ('error' in result) {
      window.alert(result.error)
      return
    }
    setProjects(await window.api.listProjects())
    await handleSwitchProject(result.project.id)
  }

  const handleDeleteProject = async (): Promise<void> => {
    if (!activeProjectId || projects.length <= 1) return
    const project = projects.find((p) => p.id === activeProjectId)
    if (!project) return
    if (!window.confirm(`Delete project "${project.name}" and all its contents? This cannot be undone.`)) return
    await window.api.deleteProject(activeProjectId)
    const remaining = await window.api.listProjects()
    setProjects(remaining)
    if (remaining.length > 0) {
      await handleSwitchProject(remaining[0].id)
    }
  }

  const handleSwitchProvider = async (newProviderId: string): Promise<void> => {
    if (!newProviderId || newProviderId === providerInfo?.id) return
    const settings = await window.api.getSettings()
    settings.defaultProvider = newProviderId
    await window.api.updateSettings(settings)
    const pcfg = settings.providers[newProviderId]
    const vdb = settings.vectorDb?.backend ?? (settings.vectorDb?.enabled !== false ? 'lancedb' : 'none')
    setProviderInfo({
      id: newProviderId,
      name: newProviderId.charAt(0).toUpperCase() + newProviderId.slice(1),
      model: pcfg?.model ?? '',
      vectorDb: vdb === 'lancedb' ? 'LanceDB' : vdb === 'gemini' ? 'Gemini File Search' : 'none'
    })
    // Start a new chat by clearing the current conversation
    setCurrentConversation(null)
    setMessages([])
    setSessionContext([])
    setLastUsage(null)
    setTotalCompletionTokens(0)
  }

  const handleSwitchPersonaFromStatus = (newFilename: string): void => {
    const selected = newFilename ? personasList.find((p) => p.filename === newFilename) : null
    setActivePersonaFilename(selected?.filename ?? null)
    setActivePersonaContent(selected?.content ?? null)
    if (selected) {
      localStorage.setItem('activePersonaFilename', selected.filename)
    } else {
      localStorage.removeItem('activePersonaFilename')
    }
    // Start a new chat
    setCurrentConversation(null)
    setMessages([])
    setSessionContext([])
    setLastUsage(null)
    setTotalCompletionTokens(0)
  }

  const handleSwitchVectorDb = async (newBackend: string): Promise<void> => {
    const settings = await window.api.getSettings()
    const current = settings.vectorDb?.backend ?? (settings.vectorDb?.enabled !== false ? 'lancedb' : 'none')
    if (newBackend === current) return
    settings.vectorDb = { ...settings.vectorDb, backend: newBackend as 'none' | 'lancedb' | 'gemini' }
    await window.api.updateSettings(settings)
    setProviderInfo((prev) => prev ? { ...prev, vectorDb: newBackend === 'lancedb' ? 'LanceDB' : newBackend === 'gemini' ? 'Gemini File Search' : 'none' } : null)
    // Start a new chat
    setCurrentConversation(null)
    setMessages([])
    setSessionContext([])
    setLastUsage(null)
    setTotalCompletionTokens(0)
  }

  const handleSelectConversation = async (id: string): Promise<void> => {
    if (!activeProjectId) return
    if (currentConversation?.id) {
      convTokenData.current.set(currentConversation.id, { lastUsage, totalCompletionTokens })
    }
    if (currentConversation?.id === id) {
      setCurrentConversation(null)
      setMessages([])
      setSessionContext([])
      setContextFiles((prev) => prev.map((f) => ({ ...f, selected: false })))
      setLastUsage(null)
      setTotalCompletionTokens(0)
      setActivePersonaFilename(null)
      setActivePersonaContent(null)
      return
    }
    const conv = await window.api.loadConversation(activeProjectId, id)
    if (conv) {
      setCurrentConversation(conv)
      setMessages(conv.messages)
      setSessionContext([])
      const savedSelection = new Set(conv.selectedContextFiles ?? [])
      setContextFiles((prev) => prev.map((f) => ({ ...f, selected: savedSelection.has(f.filename) })))
      const saved = convTokenData.current.get(id)
      setLastUsage(saved?.lastUsage ?? null)
      setTotalCompletionTokens(saved?.totalCompletionTokens ?? 0)

      // Restore the persona associated with this conversation (set directly, not via
      // handlePersonaSelect which would try to persist back to the old conversation)
      if (conv.personaFilename) {
        const personas = await window.api.listPersonas()
        const persona = personas.find((p) => p.filename === conv.personaFilename)
        setActivePersonaFilename(persona ? conv.personaFilename : null)
        setActivePersonaContent(persona?.content ?? null)
      } else {
        setActivePersonaFilename(null)
        setActivePersonaContent(null)
      }

      // Restore the AI provider and vector DB associated with this conversation
      const settings = await window.api.getSettings()
      let settingsChanged = false

      if (conv.providerId && settings.providers[conv.providerId]?.enabled !== false) {
        if (settings.defaultProvider !== conv.providerId) {
          settings.defaultProvider = conv.providerId
          settingsChanged = true
        }
      }

      if (conv.vectorDbBackend !== undefined) {
        const currentBackend = settings.vectorDb?.backend ?? (settings.vectorDb?.enabled !== false ? 'lancedb' : 'none')
        if (currentBackend !== conv.vectorDbBackend) {
          settings.vectorDb = { ...settings.vectorDb, backend: conv.vectorDbBackend as 'none' | 'lancedb' | 'gemini' }
          settingsChanged = true
        }
      }

      if (settingsChanged) {
        await window.api.updateSettings(settings)
      }

      const pid = conv.providerId ?? settings.defaultProvider
      const pcfg = settings.providers[pid]
      const vdb = conv.vectorDbBackend ?? settings.vectorDb?.backend ?? (settings.vectorDb?.enabled !== false ? 'lancedb' : 'none')
      setProviderInfo({
        id: pid,
        name: pid.charAt(0).toUpperCase() + pid.slice(1),
        model: pcfg?.model ?? '',
        vectorDb: vdb === 'lancedb' ? 'LanceDB' : vdb === 'gemini' ? 'Gemini File Search' : 'none'
      })

      // Refresh message log IDs for this conversation
      if (loggingEnabled) {
        window.api.listMessageLogs(activeProjectId).then((ids) => setMessageLogIds(new Set(ids))).catch(() => {})
      }
    }
  }

  const [messageDragOverConvId, setMessageDragOverConvId] = useState<string | null>(null)

  const handleMessageDropOnConversation = async (conversationId: string, messageContent: string): Promise<void> => {
    setMessageDragOverConvId(null)
    await handleSelectConversation(conversationId)
    setChatPrefill(messageContent)
  }

  const handleDeleteConversation = async (id: string): Promise<void> => {
    if (!activeProjectId) return
    await window.api.deleteConversation(activeProjectId, id)
    convTokenData.current.delete(id)
    if (currentConversation?.id === id) {
      setMessages([])
      setCurrentConversation(null)
      setLastUsage(null)
      setTotalCompletionTokens(0)
    }
    await refreshConversations(activeProjectId)
  }

  const handlePersonaSelect = (filename: string | null, content: string | null): void => {
    setActivePersonaFilename(filename)
    setActivePersonaContent(content)
    if (filename) {
      localStorage.setItem('activePersonaFilename', filename)
    } else {
      localStorage.removeItem('activePersonaFilename')
    }
    if (activeTab !== 'chat') shouldDeselectChat.current = true
  }

  const handleTabSwitch = (tab: AppTab): void => {
    if (tab === 'chat' && shouldDeselectChat.current) {
      shouldDeselectChat.current = false
      setCurrentConversation(null)
      setMessages([])
      setSessionContext([])
      setLastUsage(null)
      setTotalCompletionTokens(0)
    }
    setActiveTab(tab)
  }

  const handleFileDrop = async (filePaths: string[]): Promise<void> => {
    if (!activeProjectId) return
    for (const path of filePaths) {
      try {
        const parsed = await window.api.importFile(activeProjectId, path)
        setContextFiles((prev) => [...prev, { ...parsed, selected: true }])
      } catch (error) {
        console.error('Failed to import file:', error)
      }
    }
  }

  const handlePreviewFile = (filename: string): void => {
    if (!activeProjectId) return
    window.api.previewFile(activeProjectId, filename)
  }

  const handleOpenProjectDir = (): void => {
    if (!activeProjectId) return
    window.api.openProjectDir(activeProjectId)
  }

  const handleOcrFile = async (index: number): Promise<void> => {
    if (!activeProjectId) return
    const file = contextFiles[index]
    if (!file || file.type !== 'pdf') return
    try {
      await window.api.ocrFile(activeProjectId, file.filename)
      // Refresh from disk — listProjectFiles will use the .txt content for this PDF
      const files = await window.api.listProjectFiles(activeProjectId)
      setContextFiles((prev) => {
        const prevByName = new Map(prev.map((f) => [f.filename, f]))
        return files.map((f) => ({
          ...f,
          selected: prevByName.get(f.filename)?.selected ?? false
        }))
      })
    } catch (error) {
      console.error('OCR failed:', error)
    }
  }

  const handleRemoveContextFile = (index: number): void => {
    const file = contextFiles[index]
    if (file && activeProjectId) {
      window.api.deleteProjectFile(activeProjectId, file.filename).catch(console.error)
    }
    setContextFiles((prev) => {
      const removed = prev[index]
      if (removed?.filename === activeCommandFilename) {
        setActiveCommandFilename(null)
        setClearInputSignal((s) => s + 1)
      }
      return prev.filter((_, i) => i !== index)
    })
  }


  const handleAttachCommand = (command: {
    filename: string
    name: string
    content: string
    description: string
    size: number
  }): void => {
    // Remove previous command from context files if it was there
    if (activeCommandFilename) {
      setContextFiles((prev) => prev.filter((f) => f.filename !== activeCommandFilename))
    }
    // Don't add the command file to context — it's a prompt template, not context.
    // The command content is loaded and expanded in handleSend() via prepareCommandPrompt().
    setChatPrefill(`/${command.name} `)
    setActiveCommandFilename(command.filename)
  }

  const handleToggleContextFile = (index: number): void => {
    setContextFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, selected: !f.selected } : f))
    )
  }

  const handleSend = async (text: string): Promise<boolean | undefined> => {
    if (!activeProjectId) return undefined

    let promptText = text  // text actually sent to the AI (may be expanded by a command)

    // Handle slash commands
    if (text.startsWith('/')) {
      const commandName = text.slice(1).split(/\s/)[0]
      const commands = await window.api.listCommands() as { name: string; content: string }[]
      const command = commands.find((c) => c.name === commandName)
      if (!command) {
        alert(`Unknown command: /${commandName}`)
        return false
      }
      promptText = prepareCommandPrompt(text, command.content)
    }

    const selectedContextNames = contextFiles
      .filter((f) => f.selected && f.filename !== activeCommandFilename)
      .map((f) => f.filename)
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: text,  // original input — shown in chat
      timestamp: Date.now(),
      ...(selectedContextNames.length > 0 ? { contextFiles: selectedContextNames } : {})
    }

    let updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setIsLoading(true)

    let conv = currentConversation
    let hiddenContext = sessionContext

    // For existing conversations, enforce the stored persona and provider
    if (conv) {
      // Restore persona if it differs from what's currently active
      if (conv.personaFilename && conv.personaFilename !== activePersonaFilename) {
        const personas = await window.api.listPersonas()
        const persona = personas.find((p) => p.filename === conv!.personaFilename)
        if (persona) {
          setActivePersonaFilename(conv.personaFilename)
          setActivePersonaContent(persona.content)
          if (conv.personaFilename) localStorage.setItem('activePersonaFilename', conv.personaFilename)
        }
      } else if (!conv.personaFilename && activePersonaFilename) {
        setActivePersonaFilename(null)
        setActivePersonaContent(null)
        localStorage.removeItem('activePersonaFilename')
      }

      // Restore provider and vector DB if they differ from what's currently active
      const settings = await window.api.getSettings()
      let settingsChanged = false

      if (conv.providerId && settings.defaultProvider !== conv.providerId && settings.providers[conv.providerId]?.enabled !== false) {
        settings.defaultProvider = conv.providerId
        settingsChanged = true
      }

      if (conv.vectorDbBackend !== undefined) {
        const currentBackend = settings.vectorDb?.backend ?? (settings.vectorDb?.enabled !== false ? 'lancedb' : 'none')
        if (currentBackend !== conv.vectorDbBackend) {
          settings.vectorDb = { ...settings.vectorDb, backend: conv.vectorDbBackend as 'none' | 'lancedb' | 'gemini' }
          settingsChanged = true
        }
      }

      if (settingsChanged) {
        await window.api.updateSettings(settings)
        const pid = conv.providerId ?? settings.defaultProvider
        const pcfg = settings.providers[pid]
        const vdb = conv.vectorDbBackend ?? settings.vectorDb?.backend ?? (settings.vectorDb?.enabled !== false ? 'lancedb' : 'none')
        setProviderInfo({
          id: pid,
          name: pid.charAt(0).toUpperCase() + pid.slice(1),
          model: pcfg?.model ?? '',
          vectorDb: vdb === 'lancedb' ? 'LanceDB' : vdb === 'gemini' ? 'Gemini File Search' : 'none'
        })
      }
    }

    if (!conv) {
      const title = text.length > 50 ? text.substring(0, 50) + '...' : text
      conv = await window.api.createConversation(activeProjectId, title)
      const settings = await window.api.getSettings()
      const currentVdb = settings.vectorDb?.backend ?? (settings.vectorDb?.enabled !== false ? 'lancedb' : 'none')
      conv = { ...conv, personaFilename: activePersonaFilename ?? undefined, providerId: settings.defaultProvider, vectorDbBackend: currentVdb }
      setCurrentConversation(conv)

      // Set the active persona as a system message for the session
      if (activePersonaContent) {
        hiddenContext = [
          { role: 'system', content: stripFrontmatter(activePersonaContent) }
        ]
        setSessionContext(hiddenContext)
      }
    }

    // Create a pending assistant bubble immediately
    const pendingId = generateId()
    const sendStart = performance.now()
    const pendingMessage: Message = {
      id: pendingId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isPending: true,
      responseTimeMs: 0
    }
    let messagesWithPending = [...updatedMessages, pendingMessage]
    setMessages(messagesWithPending)

    // Live timer: update responseTimeMs every 100ms
    const timerInterval = setInterval(() => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === pendingId)
        if (idx === -1) return prev
        const updated = [...prev]
        updated[idx] = { ...updated[idx], responseTimeMs: Math.round(performance.now() - sendStart) }
        return updated
      })
    }, 100)

    // Listen for progress events (sources, tool calls) during the request
    const unsubProgress = window.api.onProgress((data) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === pendingId)
        if (idx === -1) return prev
        const updated = [...prev]
        const msg = { ...updated[idx] }
        if (data.type === 'sources' && data.sources) {
          msg.sources = [...(msg.sources ?? []), ...data.sources]
        } else if (data.type === 'toolCall' && data.tool) {
          msg.toolsUsed = [...(msg.toolsUsed ?? []), data.tool]
        }
        updated[idx] = msg
        return updated
      })
    })

    try {
      const selectedFiles = contextFiles.filter((f) => f.selected && f.filename !== activeCommandFilename)
      const context =
        selectedFiles.length > 0
          ? selectedFiles.map((f) => ({ filename: f.filename, content: f.content, type: f.type, ...(f.mediaType ? { mediaType: f.mediaType } : {}) }))
          : undefined

      // Use promptText for the last (current) message so command expansions reach the AI,
      // but store and display the original user input.
      // Prepend hidden bernard context so it acts as initial session context.
      const apiMessages = [
        ...hiddenContext,
        ...updatedMessages.map((m, i) =>
          i === updatedMessages.length - 1
            ? { role: m.role, content: promptText }
            : { role: m.role, content: m.content }
        )
      ]
      const allToolFilenames = new Set([...selectedToolFilenames, ...conditionalToolFilenames])
      const selectedTools = allToolFilenames.size > 0 ? Array.from(allToolFilenames) : undefined
      const conditionalTools = conditionalToolFilenames.size > 0 ? Array.from(conditionalToolFilenames) : undefined
      const response = await window.api.sendMessage({ providerId: conv.providerId ?? 'gemini', messages: apiMessages, context, selectedTools, conditionalTools, projectId: activeProjectId ?? undefined, messageId: pendingId })
      const responseTimeMs = Math.round(performance.now() - sendStart)

      clearInterval(timerInterval)
      unsubProgress()

      if (response.usage) {
        const newTotal = totalCompletionTokens + response.usage.completionTokens
        setLastUsage(response.usage)
        setTotalCompletionTokens(newTotal)
        convTokenData.current.set(conv.id, { lastUsage: response.usage, totalCompletionTokens: newTotal })

        // Annotate the user message with prompt tokens
        const lastIdx = updatedMessages.length - 1
        updatedMessages = updatedMessages.map((m, i) =>
          i === lastIdx ? { ...m, promptTokens: response.usage!.promptTokens } : m
        )
      }
      if (response.model) setProviderInfo((prev) => prev ? { ...prev, model: response.model! } : prev)
      // Replace the pending message with the final response, or remove it if empty
      const allMessages = response.content.trim()
        ? [...updatedMessages, {
            id: pendingId,
            role: 'assistant' as const,
            content: response.content,
            reasoning: response.reasoning,
            timestamp: Date.now(),
            sources: response.sources,
            toolsUsed: response.toolsUsed,
            isError: response.isError || undefined,
            completionTokens: response.usage?.completionTokens,
            responseTimeMs
          }]
        : updatedMessages
      setMessages(allMessages)
      const selectedFilenames = contextFiles.filter((f) => f.selected).map((f) => f.filename)
      conv = { ...conv, selectedContextFiles: selectedFilenames }
      setCurrentConversation(conv)
      await persistConversation(conv, allMessages)
    } catch (error) {
      clearInterval(timerInterval)
      unsubProgress()

      const isAbort = error instanceof Error && (error.name === 'AbortError' || error.message === 'Aborted')
      if (isAbort) {
        // Silently revert — remove the user message and pending bubble
        setMessages(updatedMessages.slice(0, -1))
      } else {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error('AI provider error:', errorMsg)
        // Replace pending bubble with error message
        const errorMessages = [...updatedMessages, {
          id: pendingId,
          role: 'assistant' as const,
          content: errorMsg,
          timestamp: Date.now(),
          isError: true
        }]
        setMessages(errorMessages)
        if (conv) {
          await persistConversation(conv, errorMessages)
        }
      }
    } finally {
      setIsLoading(false)
      // Refresh log IDs so the log icon only appears for messages that have a log file
      if (loggingEnabled && activeProjectId) {
        window.api.listMessageLogs(activeProjectId).then((ids) => setMessageLogIds(new Set(ids))).catch(() => {})
      }
    }
    return undefined
  }

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent): void => {
    const startX = e.clientX
    const startWidth = sidebarWidth
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    let lastWidth = startWidth
    const onMove = (ev: MouseEvent): void => {
      lastWidth = Math.max(150, Math.min(450, startWidth + ev.clientX - startX))
      setSidebarWidth(lastWidth)
    }
    const onUp = (): void => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      window.api.patchUIState({ panelSizes: { chatSidebar: lastWidth } })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  const handleContextResizeStart = useCallback((e: React.MouseEvent): void => {
    const startY = e.clientY
    const startHeight = contextPanelHeight
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
    let lastHeight = startHeight
    const onMove = (ev: MouseEvent): void => {
      lastHeight = Math.max(80, Math.min(500, startHeight + ev.clientY - startY))
      setContextPanelHeight(lastHeight)
    }
    const onUp = (): void => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      window.api.patchUIState({ panelSizes: { contextPanelHeight: lastHeight } })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [contextPanelHeight])

  return (
    <div className="app-layout">
      <div className="app-titlebar">
        <div className="app-titlebar-center">
          {(['chat', 'personas', 'commands', 'skills', 'tools', 'settings'] as AppTab[]).map((tab) => (
            <button
              key={tab}
              className={`app-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => handleTabSwitch(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <button
          className={`app-tab app-tab-right ${activeTab === 'info' ? 'active' : ''}`}
          onClick={() => handleTabSwitch('info')}
        >
          Info
        </button>
      </div>
      <div className="app-body">
        {activeTab === 'chat' && (
          <>
            <aside
              className="sidebar"
              style={{ width: sidebarWidth }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('x-nai-conversation') || e.dataTransfer.types.includes('x-nai-context-file')) e.preventDefault()
              }}
              onDrop={(e) => {
                if (e.dataTransfer.types.includes('x-nai-conversation')) { e.preventDefault(); convDragDropHandled.current = true }
                if (e.dataTransfer.types.includes('x-nai-context-file')) { e.preventDefault(); fileDragDropHandled.current = true }
              }}
            >
              {/* Project Switcher */}
              <div className="project-switcher">
                <select
                  className="project-select"
                  value={activeProjectId ?? ''}
                  onChange={(e) => handleSwitchProject(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  className="project-add-button"
                  onClick={handleCreateProject}
                  title="New project"
                >
                  +
                </button>
                <button
                  className="project-add-button"
                  onClick={handleDeleteProject}
                  disabled={projects.length <= 1}
                  title="Delete project"
                >
                  &minus;
                </button>
                <button
                  className="project-add-button"
                  onClick={handleOpenProjectDir}
                  title="Open project directory"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
              </div>

              <div className="sidebar-content">
                {conversationList.length === 0 ? (
                  <div className="sidebar-placeholder">No conversations yet</div>
                ) : (
                  <ul className="conversation-list">
                    {conversationList.map((conv) => (
                      <li
                        key={conv.id}
                        className={`conversation-item ${currentConversation?.id === conv.id ? 'active' : ''}${messageDragOverConvId === conv.id ? ' drag-target' : ''}`}
                        draggable
                        onDragStart={(e) => {
                          convDragDropHandled.current = false
                          e.dataTransfer.setData('x-nai-conversation', conv.id)
                          e.dataTransfer.effectAllowed = 'move'
                          const img = createTrashDragImage()
                          e.dataTransfer.setDragImage(img, 16, 16)
                          setTimeout(() => document.body.removeChild(img), 0)
                        }}
                        onDragEnd={async () => {
                          if (!convDragDropHandled.current) await handleDeleteConversation(conv.id)
                        }}
                        onMouseEnter={() => {
                          if ((window as any).__naiDragContent) setMessageDragOverConvId(conv.id)
                        }}
                        onMouseLeave={() => {
                          if ((window as any).__naiDragContent) setMessageDragOverConvId(null)
                        }}
                        onMouseUp={() => {
                          const content = (window as any).__naiDragContent
                          if (content) {
                            ;(window as any).__naiDragContent = null
                            setMessageDragOverConvId(null)
                            handleMessageDropOnConversation(conv.id, content)
                          }
                        }}
                      >
                        <button
                          className="conversation-item-button"
                          onClick={() => handleSelectConversation(conv.id)}
                        >
                          <span className="conversation-item-title">{conv.title}</span>
                          <span className="conversation-item-persona">
                            Persona: {conv.personaFilename ? conv.personaFilename.replace(/\.md$/i, '') : 'none'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
            <div className="sidebar-resize-handle" onMouseDown={handleSidebarResizeStart} />
            <main
              className="chat-area"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('x-nai-conversation') || e.dataTransfer.types.includes('x-nai-context-file')) e.preventDefault()
              }}
              onDrop={(e) => {
                if (e.dataTransfer.types.includes('x-nai-conversation')) { e.preventDefault(); convDragDropHandled.current = true }
                if (e.dataTransfer.types.includes('x-nai-context-file')) { e.preventDefault(); fileDragDropHandled.current = true }
              }}
            >
              <div
                className="context-panel-wrapper"
                style={contextFiles.length > 0 ? { height: contextPanelHeight } : undefined}
              >
                <ContextPanel
                  files={contextFiles}
                  onRemove={handleRemoveContextFile}
                  onToggle={handleToggleContextFile}
                  onDrop={handleFileDrop}
                  onPreviewFile={handlePreviewFile}
                  onOcrFile={handleOcrFile}
                  dragHandledRef={fileDragDropHandled}
                />
              </div>
              {contextFiles.length > 0 && (
                <div className="context-resize-handle" onMouseDown={handleContextResizeStart} />
              )}
              <MessageList messages={messages} onViewLog={loggingEnabled && activeProjectId ? (messageId) => window.api.viewMessageLog(activeProjectId, messageId) : undefined} messageLogIds={messageLogIds} activeProjectId={activeProjectId} />
              <ChatInput
                onSend={handleSend}
                disabled={isLoading}
                prefill={chatPrefill}
                onPrefillConsumed={() => setChatPrefill('')}
                clearSignal={clearInputSignal}
                draftText={chatDraft}
                onDraftChange={setChatDraft}
                initialInputHeight={uiPanelSizes.current.chatInputHeight}
              />
            </main>
            <SkillsPanel
              isOpen={showSkillsPanel}
              onToggle={() => setShowSkillsPanel(!showSkillsPanel)}
              onAttachCommand={handleAttachCommand}
              activePersonaName={(currentConversation?.personaFilename ?? activePersonaFilename)?.replace(/\.md$/i, '') ?? null}
            />
          </>
        )}
        {activeTab === 'personas' && (
          <PersonasTabView activeFilename={activePersonaFilename} onSelect={handlePersonaSelect} initialSidebarWidth={uiPanelSizes.current.personasSidebar} onSidebarResize={(w) => { uiPanelSizes.current.personasSidebar = w }} />
        )}
        {activeTab === 'commands' && <CommandsTabView initialSidebarWidth={uiPanelSizes.current.commandsSidebar} onSidebarResize={(w) => { uiPanelSizes.current.commandsSidebar = w }} />}
        {activeTab === 'skills' && <SkillsTabView initialSidebarWidth={uiPanelSizes.current.skillsSidebar} initialCollapsedSkillDirs={uiCollapsedSkillDirs.current} onSidebarResize={(w) => { uiPanelSizes.current.skillsSidebar = w }} />}
        {activeTab === 'tools' && <ToolsTabView selectedFilenames={selectedToolFilenames} conditionalFilenames={conditionalToolFilenames} onSelectionChange={setSelectedToolFilenames} onConditionalChange={setConditionalToolFilenames} initialSidebarWidth={uiPanelSizes.current.toolsSidebar} initialCollapsedMCPServers={uiCollapsedMCPServers.current} onSidebarResize={(w) => { uiPanelSizes.current.toolsSidebar = w }} />}
        {activeTab === 'settings' && <SettingsView onSettingsChange={(s) => {
          const pid = s.defaultProvider
          const pcfg = s.providers[pid]
          const vdb = s.vectorDb?.backend ?? (s.vectorDb?.enabled !== false ? 'lancedb' : 'none')
          const newInfo = {
            id: pid,
            name: pid.charAt(0).toUpperCase() + pid.slice(1),
            model: pcfg?.model ?? '',
            vectorDb: vdb === 'lancedb' ? 'LanceDB' : vdb === 'gemini' ? 'Gemini File Search' : 'none'
          }
          if (providerInfo && (newInfo.name !== providerInfo.name || newInfo.model !== providerInfo.model || newInfo.vectorDb !== providerInfo.vectorDb)) {
            shouldDeselectChat.current = true
          }
          setProviderInfo(newInfo)
        }} />}
        {activeTab === 'info' && (
          <div className="info-tab">
            <div className="info-content" dangerouslySetInnerHTML={{ __html: infoHtml }} />
          </div>
        )}
      </div>

      <div className="app-statusbar">
        <div className="status-left">
          {syncStatus ? (
            <>
              {!syncStatus.includes('complete') && <span className="status-spinner" />}
              <span className="status-label">{syncStatus}</span>
            </>
          ) : isLoading ? (
            <>
              <span className="status-spinner" />
              <span className="status-label">Sending message…</span>
            </>
          ) : lastUsage ? (
            <span className="status-label">
              ctx&thinsp;{lastUsage.promptTokens.toLocaleString()}
              &ensp;↓&thinsp;{lastUsage.completionTokens.toLocaleString()}
              &ensp;↓&thinsp;{totalCompletionTokens.toLocaleString()}&thinsp;total
            </span>
          ) : null}
        </div>
        {providerInfo && (
          <div className="status-right">
            <span style={{ color: '#666' }}>Persona: </span>
            <select
              className="status-provider-select"
              value={activePersonaFilename ?? ''}
              onChange={(e) => handleSwitchPersonaFromStatus(e.target.value)}
            >
              <option value="">none</option>
              {personasList.map((p) => (
                <option key={p.filename} value={p.filename}>{p.name}</option>
              ))}
            </select>
            <span className="status-sep"> </span>
            <span style={{ color: '#666' }}>Vector DB: </span>
            <select
              className="status-provider-select"
              value={providerInfo.vectorDb === 'LanceDB' ? 'lancedb' : providerInfo.vectorDb === 'Gemini File Search' ? 'gemini' : 'none'}
              onChange={(e) => handleSwitchVectorDb(e.target.value)}
            >
              <option value="none">none</option>
              <option value="lancedb">LanceDB</option>
              <option value="gemini">Gemini File Search</option>
            </select>
            <span className="status-sep"> </span>
            <span style={{ color: '#666' }}>AI Provider: </span>
            <select
              className="status-provider-select"
              value={providerInfo.id}
              onChange={(e) => handleSwitchProvider(e.target.value)}
            >
              {[
                { id: 'anthropic', label: 'Anthropic' },
                { id: 'gemini', label: 'Gemini' },
                { id: 'vertex', label: 'Vertex' },
                { id: 'ollama', label: 'Ollama' },
                { id: 'openai-local', label: 'OpenAI-Local' }
              ].filter((p) => availableProviders[p.id] || p.id === providerInfo.id).map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      {showSplash && <SplashScreen fading={splashFading} statusMessage={splashStatus} />}
      {showWelcome && (
        <WelcomePopup
          onClose={(dontShowAgain) => {
            setShowWelcome(false)
            if (dontShowAgain) {
              window.api.getSettings().then((cfg) => {
                window.api.updateSettings({ ...cfg, showWelcomePopup: false })
              })
            }
          }}
        />
      )}
    </div>
  )
}

export default App
