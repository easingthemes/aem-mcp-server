# AEM MCP Server (aem-mcp-server)

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js CI](https://img.shields.io/badge/node-%3E=18-blue.svg)](https://nodejs.org/)
[![AEM Compatible](https://img.shields.io/badge/aem-6.5%2B-blue.svg)](https://www.adobe.com/marketing-cloud/experience-manager.html)

AEM MCP Server is a full-featured, extensible Model Context Protocol (MCP) server for Adobe Experience Manager (AEM). 
It provides a robust REST/JSON-RPC API for content, component, and asset management, with advanced integrations for AI, chatbots, and automation. 
This project is designed for AEM developers, content teams, and automation engineers who want to manage AEM programmatically or via natural language.

---

## Overview
- **Modern, TypeScript-based AEM MCP server**
- **REST/JSON-RPC API** for AEM content, component, and asset operations
- **AI/LLM integration** (OpenAI, Anthropic, Ollama, custom HTTP APIs)
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
- **Security**: Auth, environment-based config, and safe operation defaults

---

## Quick Start

### Prerequisites
- Node.js 18+
- Access to an AEM instance (local or remote)

### Installation
```sh
npm install aem-mcp-server -g
```

### Start the Server
```sh
aem-mcp
```

---

## AI IDE Integration (Cursor, Cline, etc.)

AEM MCP Server is compatible with modern AI IDEs and code editors that support MCP protocol, such as **Cursor** and **Cline**.

### How to Connect:
1. **Install and run the AEM MCP Server** as described above.
2. **Configure your IDE** to connect to the MCP server. Example for Cursor/Cline:
   - Open your IDE's MCP server settings.
   - Add a new server with:
     - **Type:** Custom MCP
     - **url:** `http://127.0.0.1:3000/mcp`

3. **Restart your IDE** and connect. The IDE will now be able to:
   - List, search, and manage AEM content
   - Run MCP methods (CRUD, search, rollout, etc.)
   - Use AI/LLM features if enabled

Sample for AI-based code editors or custom clients:

```json
{
  "mcpServers": {
    "AEM": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

![cursor.png](docs/cursor.png)

## Usage

@[TOOL_NAME]() params

```
@scanPageComponents() /content/path/to/page
```

## Contribution
Contributions are welcome! Please open issues or pull requests for bug fixes, features, or documentation improvements.

---

## License
[MIT](LICENSE) 
