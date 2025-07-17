import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult, CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { tools } from './mcp.tools.js';
import { AEMConnector } from '../aem/aem.connector.js';
import { MCPRequestHandler } from './mcp.aem-handler.js';

export const createMCPServer = () => {
  const aemConnector = new AEMConnector();
  const mcpHandler = new MCPRequestHandler(aemConnector);

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
