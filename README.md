# AEM MCP Server (aem-mcp-server)

[![Version](https://img.shields.io/npm/v/aem-mcp-server.svg)](https://npmjs.org/package/aem-mcp-server)
[![Release Status](https://github.com/easingthemes/aem-mcp-server/actions/workflows/release.yml/badge.svg)](https://github.com/easingthemes/aem-mcp-server/actions/workflows/release.yml)
[![CodeQL Analysis](https://github.com/easingthemes/aem-mcp-server/actions/workflows/codeql-analysis.yml/badge.svg?branch=main)](https://github.com/easingthemes/aem-mcp-server/actions/workflows/codeql-analysis.yml)
[![semver: semantic-release](https://img.shields.io/badge/semver-semantic--release-blue.svg)](https://github.com/semantic-release/semantic-release)
[![AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)



AEM MCP Server is a full-featured Model Context Protocol (MCP) server for Adobe Experience Manager (AEM). 
It provides a simple integration with any AI Agent.
This project is designed for non-technical persons who want to manage AEM via natural language.

---

## Overview

- **Manage your AEM instance with natural language** — content, components, assets, workflows
- **Works with any MCP-compatible client:**
  - **AI IDEs** — Cursor, VS Code + Copilot, Windsurf, Cline, JetBrains AI Assistant, Zed
  - **CLI agents** — Claude Code, GitHub Copilot CLI, Gemini CLI, Amazon Q CLI
  - **Chat & desktop apps** — Claude Desktop, ChatGPT Desktop, Goose
- **Supports both AEMaaCS and self-hosted AEM instances**
- **Two transport modes** — stdio via `npx` (recommended, zero install) and streamable HTTP

---

## Quick Start

### Prerequisites
- Node.js 20.19.0+ || 22.12.0+ || 23+
- Access to an AEM instance (local or remote)

### Stdio Transport (recommended)

No installation needed — the AI agent downloads and spawns the process automatically via `npx`.

Add to your project's MCP config (`.mcp.json`, `.vscode/mcp.json`, `.cursor/mcp.json`, etc.):

```json
{
  "mcpServers": {
    "AEM": {
      "command": "npx",
      "args": ["-y", "aem-mcp-server", "-t", "stdio", "-H", "http://localhost:4502", "-u", "admin", "-p", "admin"]
    }
  }
}
```

> **Secrets:** Since MCP config files are typically committed to the repo, avoid hardcoding credentials. Use your client's env var syntax instead:
>
> | Client | Syntax |
> |---|---|
> | Claude Code (`.mcp.json`) | `${AEM_PASSWORD}` or `${AEM_PASSWORD:-admin}` |
> | VS Code / Copilot | `${input:aem-password}` (prompts securely) or `envFile` |
> | Cursor | `${env:AEM_PASSWORD}` |
>
> Example with env var references (Claude Code):
> ```json
> {
>   "mcpServers": {
>     "AEM": {
>       "command": "npx",
>       "args": ["-y", "aem-mcp-server", "-t", "stdio", "-H", "${AEM_HOST:-http://localhost:4502}", "-u", "${AEM_USER:-admin}", "-p", "${AEM_PASSWORD:-admin}"]
>     }
>   }
> }
> ```

### Streamable HTTP Transport (alternative)

For scenarios where you need a persistent server (shared team server, multiple clients connecting simultaneously, etc.), install globally and start the server manually:

```sh
npm install aem-mcp-server -g
aem-mcp -H=http://localhost:4502 -u=admin -p=admin
```

Then point your AI agent to the URL:

```json
{
  "mcpServers": {
    "AEM": {
      "url": "http://127.0.0.1:8502/mcp"
    }
  }
}
```

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=AEM&config=eyJ1cmwiOiJodHRwOi8vMTI3LjAuMC4xOjg1MDIvbWNwIn0%3D)

### Configuration

```
Options:
      --version    Show version number                                 [boolean]
  -H, --host                         [string] [default: "http://localhost:4502"]
  -u, --user                                         [string] [default: "admin"]
  -p, --pass                                         [string] [default: "admin"]
  -i, --id         clientId                               [string] [default: ""]
  -s, --secret     clientSecret                           [string] [default: ""]
  -m, --mcpPort                                         [number] [default: 8502]
  -t, --transport  Transport mode: http (default) or stdio
                           [string] [choices: "http", "stdio"] [default: "http"]
  -I, --instances  Named AEM instances: "local:http://localhost:4502:admin:admin
                   ,qa:https://qa.example.com:user:pass"  [string] [default: ""]
  -h, --help       Show help                                           [boolean]
```

**Authentication:**
- For **AEMaaCS**, use `clientId` and `clientSecret` for OAuth S2S authentication. [More info](https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/implementation).
- For **self-hosted AEM**, use `user`/`pass`. Default credentials are `admin:admin`.

**Multi-instance:** Connect to multiple AEM instances simultaneously:
```sh
aem-mcp --instances "author:http://localhost:4502:admin:admin,publish:http://localhost:4503:admin:admin"
```
All tools will get an `instance` parameter to target a specific instance.

---

## Features

- **57 MCP Tools** covering pages, components, assets, workflows, content fragments, and experience fragments
- **MCP Resources** — agents discover components, sites, templates, and workflow models upfront via `resources/list`, eliminating discovery roundtrips
- **Tool Annotations** — every tool tagged with `group`, `readOnly`, and `complexity` so agents can make smarter tool selection decisions
- **Response Verbosity** — `verbosity` parameter (`summary`/`standard`/`full`) on content-reading tools strips JCR internals and truncates long text
- **Actionable Errors** — error responses include `suggestion` and `alternatives` fields for self-healing agent workflows
- **Component Operations**: Update, scan, add, convert, and bulk-manage AEM components (including Experience Fragments)
- **Content & Experience Fragments**: Full CRUD + variation management for both CF and XF
- **Advanced Search**: QueryBuilder, fulltext, fuzzy, and enhanced page search
- **Replication & Workflows**: Publish/unpublish content, start/advance/delegate workflow stages
- **Text & Image Extraction**: Extract all text and images from pages, including fragments
- **Template & Structure Discovery**: List templates, analyze page/component structure
- **Multi-instance**: Connect to multiple AEM instances simultaneously; tools and resources are instance-aware
- **Security**: Basic auth and OAuth S2S, environment-based config, safe operation defaults

---

## Usage

Once configured in your AI IDE, just ask in natural language:

```
List all components on MyPage
```

## MCP Resources

The server exposes read-only MCP resources so agents can discover AEM catalogs without tool calls:

| Resource URI | Description |
|---|---|
| `aem://{instance}/components` | All components (name, resourceType, title, group) |
| `aem://{instance}/sites` | Site roots and language structure under /content |
| `aem://{instance}/templates` | Available page templates (path, title) |
| `aem://{instance}/workflow-models` | Workflow models (ID, title, description) |

Resources return summary data only. In multi-instance mode, each instance gets its own set of resource URIs.

## API Documentation

For detailed API documentation, please refer to the [API Docs](docs/API.md).

## Similar Projects

1. https://github.com/easingthemes/aem-mcp-server (Used as a base for this project)
1. https://github.com/indrasishbanerjee/aem-mcp-server (Used as a base for #1)
1. https://www.npmjs.com/package/@myea/aem-mcp-handler (Looks like an original source of #2)
