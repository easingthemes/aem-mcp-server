import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { tools } from './mcp.tools.js';
import { AEMConnector } from '../aem/aem.connector.js';
import { MCPRequestHandler } from './mcp.aem-handler.js';
import { CliParams } from '../types.js';

export const createMCPServer = (cliParams: CliParams) => {
  const aemConnector = new AEMConnector(cliParams);
  const mcpHandler = new MCPRequestHandler(cliParams, aemConnector);

  const server = new Server({
    name: 'aem-mcp-server',
    version: '1.0.0',
  }, {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!args) {
      return {
        content: [
          { type: 'text', text: 'Error: No arguments provided' },
        ],
        isError: true,
      };
    }
    try {
      const result = await mcpHandler.handleRequest(name, args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  });

  return server;
}
