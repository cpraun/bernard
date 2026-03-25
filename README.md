# Bernard

A personal AI chat desktop application built with Electron, React, and TypeScript.

![Bernard Screenshot](docs/screenshot1.png)

## Overview

**Bernard** is a free, open-source AI frontend desktop application for users who want full control over their AI interactions and the flow of information.

Bernard is described in detail at [https://bernard-ai.org](https://bernard-ai.org).

Bernard connects to multiple AI providers, supports tool use via the Model Context Protocol (MCP), and provides a local vector DB backend for RAG. All data stays on your machine unless you explicitly send it to an AI provider. The app is built with a focus on transparency, configurability, and extensibility.

### Key Concepts

Bernard is built around four key concepts that let you tailor its capabilities to specific work domains and ground your interactions with domain knowledge:

- **Persona** — Always active in the background
- **Skills** — Triggered automatically when relevant
- **Commands** — Triggered explicitly by the user in a chat input
- **Tools** — Enable the AI model to access information from specific services and information sources via the Model Context Protocol (MCP)

### Prerequisites

Bernard currently runs on macOS (Apple Silicon). Access to cloud AI providers such as Google's Gemini, Vertex AI, and Anthropic's Claude requires authentication credentials or an API key. Local AI providers like [Ollama](https://ollama.com/) and [LM Studio](https://lmstudio.ai/) are also supported.

All data is stored locally. No data is sent to external services except for calls to the AI provider (local or cloud).

## Requirements

To use Bernard you need at least one AI provider. Bernard supports both cloud and local providers — you can mix and match as needed.

**Cloud providers** (require an API key or endpoint):

- **Google Gemini** — API key from [Google AI Studio](https://aistudio.google.com/apikey)
- **Anthropic Claude** — API key from the [Anthropic Console](https://console.anthropic.com/)
- **Google Vertex AI** — Google Cloud project with a deployed model endpoint, plus Application Default Credentials via `gcloud auth application-default login`

**Local providers** (require a running server on your machine):

- **Ollama** — Download from [ollama.com](https://ollama.com). Runs on `http://localhost:11434` by default
- **LM Studio** — Download from [lmstudio.ai](https://lmstudio.ai). Provides an OpenAI-compatible endpoint on `http://localhost:1234` by default
- **Any OpenAI-compatible server** — llama.cpp, vLLM, or similar

**For RAG / Skills** (optional):

- LanceDB backend: requires an embedding provider — Ollama or an OpenAI-compatible server
- Gemini File Search backend: requires a Gemini API key

**For MCP tools** (optional):

- Node.js (for `npx`-based stdio MCP servers)

**For development:**

- Node.js 18+
- npm

## Installation (macOS)

The DMG installer is not signed with an Apple Developer certificate. On first launch, macOS will block the application. To allow it, open **System Settings > Privacy & Security**, scroll down to the security section, and click **Open Anyway** next to the message about Bernard being blocked. This only needs to be done once.

## Project Structure

```text
src/
├── main/                  # Electron main process
│   ├── index.ts           # App lifecycle, window management
│   ├── ipc/               # IPC handler registration
│   ├── providers/         # AI provider implementations
│   └── services/          # Config, storage, file parsing, MCP host
├── preload/               # Context bridge (security boundary)
│   ├── index.ts           # Exposed APIs
│   └── index.d.ts         # Type declarations for window.api
├── renderer/src/          # React UI
│   ├── App.tsx            # Main layout and state
│   ├── components/        # Chat input, message list, context panel
│   ├── views/             # Tab views (Personas, Commands, Skills, Tools, Settings)
│   ├── types/             # TypeScript interfaces
│   └── assets/            # CSS, info page
└── shared/                # Types shared between main and renderer
```

## Data Storage

All application data is stored under `~/.bernard/`:

| Path | Contents |
| --- | --- |
| `~/.bernard/config.json` | Provider API keys and settings |
| `~/.bernard/projects/` | Project directories and conversation history |
| `~/.bernard/skills/` | Skill documents (Markdown, PDF, DOCX, MSG) |
| `~/.bernard/commands/` | Command template Markdown files |
| `~/.bernard/tools/` | Tool definitions (JSON + JS), MCP server configs |
| `~/.bernard/personas/` | Persona Markdown files |

## Development

```bash
# Install dependencies
npm install

# Start in development mode
npm run dev

# Type-check
npm run typecheck

# Build for production (macOS / Windows / Linux)
npm run build:mac
npm run build:win
npm run build:linux
```

## Adding a New AI Provider

1. Create `src/main/providers/YourProvider.ts` implementing the `NAIProvider` interface.
2. Add a `case` for your provider in `src/main/providers/ProviderFactory.ts`.
3. Add an entry to `PROVIDER_DEFINITIONS` in `src/renderer/src/views/SettingsView.tsx`.

## About the Name

This app is called Bernard after [Bernard of Chartres](https://en.wikipedia.org/wiki/Bernard_of_Chartres), the 12th-century philosopher who used to say that *"we are like dwarves perched on the shoulders of giants, and thus we are able to see more and farther than the latter."* In the same spirit, this application stands on the shoulders of AI providers and the large language models they created.

Bernard was developed in 2026 by [Christoph von Praun](https://www.linkedin.com/in/cpraun/) using Claude Code.

## License

Apache 2.0 — see [LICENSE](LICENSE).

Third-party software acknowledgements are listed in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
