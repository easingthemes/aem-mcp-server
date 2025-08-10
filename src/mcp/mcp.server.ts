import { CallToolRequestSchema, ListToolsRequestSchema, InitializeRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { tools } from './mcp.tools.js';
import { MCPRequestHandler } from './mcp.aem-handler.js';
import { CliParams } from '../types.js';

export const createMCPServer = (cliParams: CliParams) => {
  const mcpHandler = new MCPRequestHandler(cliParams);

  const serverInfo = {
    name: 'aem-mcp-server',
    version: '1.0.0',
  };
  const serverData = {
    capabilities: {
      resources: {},
      tools: {}
    },
  };

  const server = new Server(serverInfo, serverData);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.log('2. Received ListToolsRequest', tools);
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    console.log('Received CallToolRequestSchema', request.params);
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
      console.error('ERROR CallToolRequestSchema', error.message);
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  });

  return server;
}
