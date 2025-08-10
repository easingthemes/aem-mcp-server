import { randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { transports } from './mcp.transports.js';
import { createMCPServer } from './mcp.server.js';
import { CliParams } from '../types.js';
import { LOGGER } from '../utils/logger.js';

export const handleRequest = async (req: Request, res: Response, cliParams: CliParams) => {
  LOGGER.log('1.Received MCP request:', req.body);
  const { jsonrpc, id, method, params } = req.body;
  if (jsonrpc !== '2.0' || !method) {
    res.status(400).json({
      jsonrpc: '2.0',
      id: id || null,
      error: { code: -32600, message: 'Invalid Request', data: 'Must be valid JSON-RPC 2.0' },
    });
    return;
  }
  try {
    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      LOGGER.log(`Session exists: ${sessionId}`);
      transport = transports[sessionId]
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request - use JSON response mode
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true, // Enable JSON response mode
        onsessioninitialized: (sessionId) => {
          // Store the transport by session ID when session is initialized
          // This avoids race conditions where requests might come in before the session is stored
          LOGGER.log(`Session initialized with ID: ${sessionId}`);
          transports[sessionId] = transport;
        }
      });

      // Connect the transport to the MCP server BEFORE handling the request
      LOGGER.log('Connecting to MCP server with CLI params:', cliParams);
      const server = createMCPServer(cliParams);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return; // Already handled
    } else {
      // Invalid request - no session ID or not initialization request
      LOGGER.log('Invalid request - no session ID or not initialization request');
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    // Handle the request with existing transport - no need to reconnect
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    LOGGER.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
};
