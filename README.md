# AEM MCP Server (aem-mcp-server)

[![Version](https://img.shields.io/npm/v/@easingthemes/aem-mcp-server.svg)](https://npmjs.org/package/@easingthemes/aem-mcp-server)
[![Release Status](https://github.com/easingthemes/aem-mcp-server/actions/workflows/release.yml/badge.svg)](https://github.com/easingthemes/aem-mcp-server/actions/workflows/release.yml)
[![CodeQL Analysis](https://github.com/easingthemes/aem-mcp-server/workflows/CodeQL/badge.svg?branch=main)](https://github.com/easingthemes/aem-mcp-server/actions)
[![semver: semantic-release](https://img.shields.io/badge/semver-semantic--release-blue.svg)](https://github.com/semantic-release/semantic-release)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

AEM MCP Server is a full-featured Model Context Protocol (MCP) server for Adobe Experience Manager (AEM). 
It provides a simple integration with any AI Agent.
This project is designed for non-technical persons who want to manage AEM via natural language.

---

## Overview

- **Chat with your AEM instance** for content, component, and asset operations.
- **AI IDEs integration** (Cursor, Copilot, Webstorm, VS Code, etc.)
- **Production-ready, modular, and configurable**
- **Modern, TypeScript-based AEM MCP server**
- **REST/JSON-RPC API** with latest MCP features.

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

### Configuration
```
Options:
      --version    Show version number                                      [boolean]
  -H, --host       Author instance URL [string]    [default: "http://localhost:4502"]
  -P, --publisher  Publisher instance URL [string] [default: "http://localhost:4503"]
  -u, --user       Username for authentication            [string] [default: "admin"]
  -p, --pass       Password for authentication            [string] [default: "admin"]
  -m, --mcpPort    Port for MCP server                       [number] [default: 3000]
  -e, --explorer   Enable Swagger API explorer             [boolean] [default: false]
  -h, --help       Show help                                                [boolean]

```
---

## AI IDE Integration (Cursor, Copilot, etc.)

AEM MCP Server is compatible with modern AI IDEs and code editors that support MCP protocol, such as **Cursor** and **Copilot** (eg in WebStorm or VS Code).

### How to Connect:
1. **Install and run the AEM MCP Server** as described above.
2. **Configure your IDE** to connect to the MCP server:
   - Open your IDE's MCP server settings.
   - Add a new server with:
     - **Type:** Custom MCP
     - **url:** `http://127.0.0.1:3000/mcp`

3. **Restart your IDE** if needed. The IDE will now be able to:
   - List, search, and manage AEM content
   - Run MCP methods (CRUD, search, rollout, etc.)

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

```
List all components on MyPage
```

## API Documentation

For detailed API documentation, please refer to the [API Docs](docs/API.md).
