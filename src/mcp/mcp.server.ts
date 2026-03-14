import { CallToolRequestSchema, ListToolsRequestSchema, InitializeRequestSchema, LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { tools } from './mcp.tools.js';
import { MCPRequestHandler } from './mcp.aem-handler.js';
import { CliParams } from '../types.js';
import { LOGGER } from '../utils/logger.js';

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
    instructions: 'This is an AEM MCP server that provides tools for managing AEM components and content.',
  };

  const server = new Server(serverInfo, serverData);

  server.setRequestHandler(InitializeRequestSchema, (_request) => {
    const requestedVersion = _request.params.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
      ? requestedVersion
      : LATEST_PROTOCOL_VERSION;
    LOGGER.log('1. Received InitializeRequest', _request, 'response:', { protocolVersion });
    return {
      protocolVersion,
      ...serverData,
      serverInfo,
    }
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    LOGGER.log('2. Received ListToolsRequest', tools);
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    LOGGER.log('3. Received CallToolRequestSchema', request.params);
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
      
      // Check if result contains OAuth redirect info
      if (result && typeof result === 'object' && 'error' in result && result.error?.code === 'OAUTH_REQUIRED') {
        const authInfo = {
          error: 'OAuth authentication required',
          message: result.error.message,
          authUrl: result.error.authUrl,
          redirectUri: result.error.redirectUri,
          instructions: 'Please open the authUrl in your browser to authorize the application. After authorization, you can retry this operation.',
        };
        return {
          content: [
            { 
              type: 'text', 
              text: JSON.stringify(authInfo, null, 2) 
            }
          ],
          isError: true,
        };
      }
      
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      LOGGER.error('ERROR CallToolRequestSchema', error.message);
      
      // Check if it's an OAuth error
      if (error.code === 'OAUTH_REQUIRED' && error.authUrl) {
        const authInfo = {
          error: 'OAuth authentication required',
          message: error.message,
          authUrl: error.authUrl,
          instructions: 'Please open the authUrl in your browser to authorize the application.',
        };
        return {
          content: [
            { 
              type: 'text', 
              text: JSON.stringify(authInfo, null, 2) 
            }
          ],
          isError: true,
        };
      }
      
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  });

  return server;
}
