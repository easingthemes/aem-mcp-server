import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMCPServer } from './mcp.server.js';
import { CliParams } from '../types.js';
import { LOGGER } from '../utils/logger.js';

/**
 * Start the MCP server in stdio mode.
 * MCP clients (Claude Code, Cursor, etc.) manage the process lifecycle —
 * they launch this as a subprocess and communicate via stdin/stdout.
 */
export async function startStdio(params: CliParams): Promise<void> {
  try {
    const server = createMCPServer(params);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    LOGGER.log('AEM MCP server running in stdio mode');
  } catch (error: any) {
    process.stderr.write(`Fatal: ${error.message}\n`);
    process.exit(1);
  }
}
