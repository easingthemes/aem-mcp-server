import express, { Request, Response } from 'express';
import cors from 'cors';
import { handleRequest } from '../mcp/mcp.server-handler';
import { useBasicAuth } from './app.auth.js';
import { AEMConnector } from '../aem/aem.connector.js';
import { MCPRequestHandler } from '../mcp/mcp.aem-handler.js';
import { config } from '../config.js';
import { useExplorer } from '../explorer/api.explorer.js';

const app = express();

app.use(cors({
  origin: '*', // Allow all origins - adjust as needed for production
  exposedHeaders: ['Mcp-Session-Id']
}));
app.use(express.json());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// useBasicAuth(app);
useExplorer(app);

const aemConnector = new AEMConnector();
const mcpHandler = new MCPRequestHandler(aemConnector);

app.get('/health', async (req: Request, res: Response) => {
  try {
    const result = await mcpHandler.handleHealthCheck();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ status: 'unhealthy', error: error.message, timestamp: new Date().toISOString() });
  }
});

app.get('/mcp/methods', async (req: Request, res: Response) => {
  try {
    const methods = mcpHandler.getAvailableMethods();
    res.json({ methods, total: methods.length, timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/mcp', async (req: Request, res: Response) => {
  console.log('Received MCP request:', req.body);
  await handleRequest(req, res);
});

app.get('/mcp', async (req: Request, res: Response) => {
  res.status(405).set('Allow', 'POST').send('Method Not Allowed');
});

app.delete('/mcp', async (req: Request, res: Response) => {
  console.log('Received DELETE MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});

app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'AEM MCP Gateway Server',
    description: 'A Model Context Protocol server for Adobe Experience Manager',
    version: config.APP_VERSION || '1.0.0',
    endpoints: {
      health: { method: 'GET', path: '/health', description: 'Health check for all services' },
      mcp: { method: 'POST', path: '/mcp', description: 'JSON-RPC endpoint for MCP calls' },
      mcpMethods: { method: 'GET', path: '/mcp/methods', description: 'List all available MCP methods' },
    },
    architecture: 'MCP integration',
    timestamp: new Date().toISOString(),
  });
});

export const startServer = (PORT = 3000, startExplorer = false) => {
  app.listen(PORT, (error) => {
    if (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
    console.log(`AEM MCP Server listening on port ${PORT}`);
  });
};


process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  process.exit(0);
});
