# AEM MCP Server (aem-mcp-server)

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js CI](https://img.shields.io/badge/node-%3E=18-blue.svg)](https://nodejs.org/)
[![AEM Compatible](https://img.shields.io/badge/aem-6.5%2B-blue.svg)](https://www.adobe.com/marketing-cloud/experience-manager.html)
[![ChatOps](https://img.shields.io/badge/chatops-telegram-blue.svg)](https://telegram.org/)

AEM MCP Server is a full-featured, extensible Model Context Protocol (MCP) server for Adobe Experience Manager (AEM). It provides a robust REST/JSON-RPC API for content, component, and asset management, with advanced integrations for AI, chatbots, and automation. This project is designed for AEM developers, content teams, and automation engineers who want to manage AEM programmatically or via natural language.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Quick Start](#quick-start)
- [Usage Examples](#usage-examples)
- [Configuration](#configuration)
- [API & Client Usage](#api--client-usage)
- [AI IDE Integration (Cursor, Cline, etc.)](#ai-ide-integration-cursor-cline-etc)
- [Security](#security)
- [Project Structure](#project-structure)
- [Integrations](#integrations)
- [Contribution](#contribution)
- [License](#license)

---

## Overview
- **Modern, TypeScript-based AEM MCP server**
- **REST/JSON-RPC API** for AEM content, component, and asset operations
- **AI/LLM integration** (OpenAI, Anthropic, Ollama, custom HTTP APIs)
- **Telegram bot** for conversational AEM management
- **Production-ready, modular, and extensible**

---

## Features
- **AEM Page & Asset Management**: Create, update, delete, activate, deactivate, and replicate pages and assets
- **Component Operations**: Validate, update, scan, and manage AEM components (including Experience Fragments)
- **Advanced Search**: QueryBuilder, fulltext, fuzzy, and enhanced page search
- **Replication & Rollout**: Publish/unpublish content, roll out changes to language copies
- **Text & Image Extraction**: Extract all text and images from pages, including fragments
- **Template & Structure Discovery**: List templates, analyze page/component structure
- **JCR Node Access**: Legacy and modern node/content access
- **AI/LLM Integration**: Natural language interface for AEM via OpenAI, Anthropic, Ollama, or custom LLMs
- **Telegram Bot**: Manage AEM via chat, including conversational commands
- **Security**: Auth, environment-based config, and safe operation defaults

---

## Quick Start

### Prerequisites
- Node.js 18+
- Access to an AEM instance (local or remote)

### Installation
```sh
cd clone
npm install
```

### Build
```sh
npm run build
```

### Run (Production)
```sh
npm start
```

### Run (Development, hot reload)
```sh
npm run dev
```

---

## Usage Examples

### 1. List all pages under a path
```sh
curl -u admin:admin \
  -X POST http://localhost:8080/api \
  -H 'Content-Type: application/json' \
  -d '{"method":"mcp_aem-mcp_listPages","params":{"siteRoot":"/content/we-retail","depth":2,"limit":10}}'
```

### 2. Update a component property
```sh
curl -u admin:admin \
  -X POST http://localhost:8080/api \
  -H 'Content-Type: application/json' \
  -d '{"method":"mcp_aem-mcp_updateComponent","params":{"componentPath":"/content/we-retail/us/en/experience/jcr:content/root/hero_image","properties":{"Heading":"New Heading"}}}'
```

### 3. Use with AI IDEs (Cursor, Cline, etc.)
- See the [AI IDE Integration](#ai-ide-integration-cursor-cline-etc) section below.

---

## Configuration

### Environment Variables
Create a `.env` file in the project root with the following (edit as needed):

```
AEM_HOST=http://localhost:4502
AEM_SERVICE_USER=admin
AEM_SERVICE_PASSWORD=admin
MCP_PORT=8080
GATEWAY_PORT=3000
OPENAI_API_KEY=your-openai-key
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
MCP_USERNAME=admin
MCP_PASSWORD=admin
```

### MCP Client Configuration
Sample for AI-based code editors or custom clients:

```json
{
  "mcpServers": {
    "aem-mcp": {
      "command": "node",
      "args": [
        "absolute path to dist/mcp-server.js"
      ]
    }
  }
}
```

---

## API & Client Usage
- **REST/JSON-RPC**: Exposes all AEM operations via HTTP endpoints
- **Supported Operations**: Page/asset CRUD, component validation/update, search, rollout, publish, text/image extraction, and more
- **AI/LLM**: Send natural language commands to the server (via API or Telegram)
- **Telegram Bot**: Connect your bot using `TELEGRAM_BOT_TOKEN` and chat with your AEM instance

---

## AI IDE Integration (Cursor, Cline, etc.)

AEM MCP Server is compatible with modern AI IDEs and code editors that support MCP protocol, such as **Cursor** and **Cline**.

### How to Connect:
1. **Install and run the AEM MCP Server** as described above.
2. **Configure your IDE** to connect to the MCP server. Example for Cursor/Cline:
   - Open your IDE's MCP server settings.
   - Add a new server with:
     - **Type:** Custom MCP
     - **Command:** `node`
     - **Args:** `["/absolute/path/to/dist/mcp-server.js"]`
     - **Port:** `8080` (or as configured)
     - **Auth:** Use `MCP_USERNAME`/`MCP_PASSWORD` from your `.env`
3. **Restart your IDE** and connect. The IDE will now be able to:
   - List, search, and manage AEM content
   - Run MCP methods (CRUD, search, rollout, etc.)
   - Use AI/LLM features if enabled

### Custom MCP Clients
- You can build your own MCP client in any language that supports HTTP/JSON-RPC.
- See the [Usage Examples](#usage-examples) for API call patterns.
- Authenticate using basic auth (`MCP_USERNAME`/`MCP_PASSWORD`).
- All MCP methods are available via the `/api` endpoint.

---

## Security
- Auth required for all operations (see `MCP_USERNAME`/`MCP_PASSWORD`)
- Environment-based configuration for safe deployment
- All destructive operations require explicit parameters and validation

---

## Project Structure
- `src/` — TypeScript source code
- `dist/` — Compiled JS output

---

## Integrations
- **AI/LLM**: OpenAI, Anthropic, Ollama, custom HTTP APIs
- **Telegram**: Chat-based AEM management

---

## Contribution
Contributions are welcome! Please open issues or pull requests for bug fixes, features, or documentation improvements.

---

## License
[MIT](LICENSE) 