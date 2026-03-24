# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
