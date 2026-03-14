import { CallToolRequestSchema, ListToolsRequestSchema, InitializeRequestSchema, LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { tools, injectInstanceParam } from './mcp.tools.js';
import { InstanceRegistry } from './mcp.instances.js';
import { CliParams } from '../types.js';
import { LOGGER } from '../utils/logger.js';

export const createMCPServer = (cliParams: CliParams) => {
  const registry = new InstanceRegistry(cliParams);
  const instanceNames = registry.getInstanceNames();
  const isMultiInstance = instanceNames.length > 1;

  const serverInfo = {
    name: 'aem-mcp-server',
    version: '1.0.0',
  };
  const serverData = {
    capabilities: {
      resources: {},
      tools: {}
    },
    instructions: isMultiInstance
      ? `AEM MCP server with ${instanceNames.length} instances: ${instanceNames.join(', ')}. ` +
        `Use the "instance" parameter to target a specific instance (default: "${registry.getDefaultName()}").`
      : 'This is an AEM MCP server that provides tools for managing AEM components and content.',
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
    const exportedTools = isMultiInstance
      ? injectInstanceParam(tools, instanceNames, registry.getDefaultName())
      : tools;
    LOGGER.log('2. Received ListToolsRequest', exportedTools);
    return { tools: exportedTools };
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
      const { instance, ...toolArgs } = args as Record<string, unknown>;
      const handler = registry.getHandler(instance as string | undefined);
      const result = await handler.handleRequest(name, toolArgs);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      LOGGER.error('ERROR CallToolRequestSchema', error.message);
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  });

  return server;
}
