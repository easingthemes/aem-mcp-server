# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run build              # Full build (types + esbuild)
npm run build:ts           # esbuild only (faster, no type checking)
npm run build:types        # TypeScript declaration files only
npm run start              # Run with MCP_LOGGER=true (HTTP transport)
node dist/cli.js -t stdio  # Run with stdio transport
```

No test framework is configured. `npm test` is a no-op (`--if-present`).

## Commit Convention

Uses Angular Commit Message format for semantic-release:
```
<type>(<scope>): <short summary>
```
Types: `build|ci|docs|feat|fix|perf|refactor|test`. Breaking changes require `BREAKING CHANGE:` in the commit footer.

## Architecture

This is an MCP (Model Context Protocol) server that exposes Adobe Experience Manager (AEM) operations as tools for LLM clients.

### Three-Layer Design

**CLI** (`src/cli.ts`) → parses args via yargs, selects transport (HTTP or stdio)

**MCP Layer** (`src/mcp/`) → protocol handling:
- `mcp.server.ts` — creates MCP `Server`, registers Initialize/ListTools/CallTool handlers
- `mcp.tools.ts` — 51 tool definitions as Zod schemas (converted to JSON Schema via `zod-to-json-schema`); `injectInstanceParam()` adds an `instance` param when multi-instance is active; exports `toolSchemas` for runtime validation
- `mcp.aem-handler.ts` — `MCPRequestHandler` validates inputs via Zod then dispatches tool name → `AEMConnector` method via a switch statement
- `mcp.instances.ts` — `InstanceRegistry` parses `--instances` flag, creates per-instance `MCPRequestHandler`
- `mcp.stdio.ts` / `mcp.server-handler.ts` — transport-specific setup (stdio vs StreamableHTTPServerTransport)

**AEM Layer** (`src/aem/`) → all AEM interaction:
- `aem.connector.ts` — main connector class delegating to domain managers and handling pages, components, assets, workflows, search
- `aem.content-fragments.ts` — `ContentFragmentManager` with AEMaaCS CF API / AEM 6.5 Assets API routing
- `aem.experience-fragments.ts` — `ExperienceFragmentManager` for XF CRUD and variations via Sling POST
- `aem.fetch.ts` — `AEMFetch` wraps native fetch with Basic or OAuth auth headers (get/post/put/delete)
- `aem.auth.ts` — OAuth Server-to-Server token management via Adobe IMS
- `aem.config.ts` — configuration interfaces
- `aem.errors.ts` — `AEMOperationError` with typed error codes and HTTP status mapping

### Adding a New Tool

1. Add a Zod schema to the appropriate group in `mcp.tools.ts` (use `.passthrough()` on the `z.object()`) and add the description to `toolDescriptions`
2. Add the method implementation — either in `aem.connector.ts` directly, or in a domain manager class (e.g., `aem.content-fragments.ts`) with a delegate method on the connector
3. Add the case to the switch in `mcp.aem-handler.ts` to wire them together

### Key Patterns

- **Multi-instance**: `--instances "name:host:user:pass,name2:host2:user2:pass2"` creates independent connectors; tools get an `instance` parameter injected dynamically
- **Auth**: Basic auth (user/pass) for self-hosted AEM, OAuth S2S (clientId/clientSecret) for AEMaaCS — determined by presence of `id`/`secret` params
- **Logger**: `LOGGER.log`/`info` gated by `MCP_LOGGER` env var (writes to stdout); `LOGGER.warn`/`error` always write to stderr (safe for stdio)
- **Zod**: Pinned to `zod@3.24.4` — do NOT upgrade to 3.25+/4.x (breaks `zod-to-json-schema` and has bugs in built-in `z.toJSONSchema()` with `z.record()`)
- **ESM**: Project uses `"type": "module"` — all imports use `.js` extensions
