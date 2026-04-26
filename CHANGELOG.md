# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.1] - 2026-04-26

### Changed

- Renamed "Personas" to "Agents" throughout the application (tabs, labels, file paths, and demo profile)
- Renamed Google "Vertex AI" provider to "Enterprise Agent Platform" in the UI
- Changed example HTTPS MCP service in the demo profile to the Microsoft Learn MCP endpoint

### Added

- "Improve" action in the Agents, Commands, and Skills tab editors, allowing AI-assisted refinement of content
- Built-in `task`, `web_fetch`, and `read` tools available to all AI providers (no MCP server required)

### Fixed

- Gemma 4 support as a local model via LM Studio: added parsing for Gemma 4's native `<tool_call>` tag format, deduplication of duplicate tool calls, and correct AbortError propagation so ESC interrupts tool-calling loops reliably
- Updated available foundation models for Anthropic, Gemini, and Ollama providers

---

## [1.0.0] - 2026-03-15

Initial release, tested and available on macOS 26.3 (Apple Silicon).

### Added

- Multi-provider AI chat with support for Gemini, Anthropic Claude, Ollama, and OpenAI-compatible local servers
- Project-based conversation management with local storage in `~/.bernard/projects/`
- Drag-and-drop context file support (TXT, MD, PDF, DOCX, MSG, EML) with per-message toggle
- PDF OCR via Google Cloud Vision API
- Personas system for reusable AI system prompts
- Slash commands with Markdown templates, argument substitution, and persona restrictions
- Skills & RAG with two vector DB backends (LanceDB local, Gemini File Search cloud)
- Local JavaScript tool definitions with JSON schema and JS implementation
- MCP server integration with stdio and HTTP transports, auto-discovery of tools
- Three-state tool selection: off, always-on, and conditional (with user approval dialog)
- Syntax-highlighted tool editor with rename, drag-to-delete, and whitespace visualization
- Configurable provider settings (API key, base URL, model, temperature, top-K, max output tokens)
- Light and dark theme with system auto-detection
- Interaction logging with per-message log viewer
- Cross-platform builds for macOS (ARM64 and x64), Windows, and Linux
- Demo profile with example commands, personas, skills, and tools for first-time users
- Welcome popup with getting-started guidance
