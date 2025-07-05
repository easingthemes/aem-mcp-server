import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { AEMConnector } from './aem-connector.js';
import { MCPRequestHandler } from './mcp-handler.js';
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';
// import llmRouter from './llm-integration.js';
// import telegramIntegration from './telegram-integration.js';
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const MCP_PORT = parseInt(process.env.MCP_PORT || '8080', 10);
const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '3000', 10);
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, '../public')));
const basicAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');
    const validUsername = process.env.MCP_USERNAME || 'admin';
    const validPassword = process.env.MCP_PASSWORD || 'admin';
    if (username !== validUsername || password !== validPassword) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
    }
    next();
};
if (process.env.MCP_USERNAME && process.env.MCP_PASSWORD) {
    app.use('/mcp', basicAuth);
}
const aemConnector = new AEMConnector();
const mcpHandler = new MCPRequestHandler(aemConnector);
app.get('/health', async (req, res) => {
    try {
        const aemConnected = await aemConnector.testConnection();
        res.json({
            status: 'healthy',
            aem: aemConnected ? 'connected' : 'disconnected',
            mcp: 'ready',
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '1.0.0',
            ports: { gateway: GATEWAY_PORT, mcp: MCP_PORT },
        });
    }
    catch (error) {
        res.status(500).json({ status: 'unhealthy', error: error.message, timestamp: new Date().toISOString() });
    }
});
app.post('/mcp', async (req, res) => {
    try {
        const { jsonrpc, id, method, params } = req.body;
        if (jsonrpc !== '2.0' || !method) {
            res.status(400).json({
                jsonrpc: '2.0',
                id: id || null,
                error: { code: -32600, message: 'Invalid Request', data: 'Must be valid JSON-RPC 2.0' },
            });
            return;
        }
        const result = await mcpHandler.handleRequest(method, params || {});
        res.json({ jsonrpc: '2.0', id: id || null, result });
    }
    catch (error) {
        res.json({
            jsonrpc: '2.0',
            id: req.body?.id || null,
            error: { code: -32000, message: error.message || 'Internal error', data: error.stack },
        });
    }
});
app.get('/mcp/methods', async (req, res) => {
    try {
        const methods = mcpHandler.getAvailableMethods();
        res.json({ methods, total: methods.length, timestamp: new Date().toISOString() });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// app.use('/api', llmRouter);
// app.use('/webhook', telegramIntegration);
app.get('/', (req, res) => {
    res.json({
        name: 'AEM MCP Gateway Server',
        description: 'A Model Context Protocol server for Adobe Experience Manager',
        version: process.env.npm_package_version || '1.0.0',
        endpoints: {
            health: { method: 'GET', path: '/health', description: 'Health check for all services' },
            mcp: { method: 'POST', path: '/mcp', description: 'JSON-RPC endpoint for MCP calls' },
            mcpMethods: { method: 'GET', path: '/mcp/methods', description: 'List all available MCP methods' },
        },
        architecture: 'MCP integration',
        timestamp: new Date().toISOString(),
    });
});
const swaggerDefinition = {
    openapi: '3.0.0',
    info: {
        title: 'AEM MCP Gateway API',
        version: '1.0.0',
        description: 'API documentation for the AEM MCP Gateway Server',
    },
    servers: [
        { url: `http://localhost:${GATEWAY_PORT}` },
    ],
};
const options = {
    swaggerDefinition,
    apis: [], // No JSDoc comments, so we define paths below
};
const openapiSpec = swaggerJSDoc(options);
openapiSpec.paths = {
    '/mcp': {
        post: {
            summary: 'JSON-RPC endpoint for MCP calls',
            description: 'Call MCP methods using JSON-RPC 2.0. The method and params must be provided in the request body.',
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                jsonrpc: { type: 'string', example: '2.0' },
                                id: { type: 'integer', example: 1 },
                                method: { type: 'string', example: 'listMethods' },
                                params: { type: 'object' },
                            },
                            required: ['jsonrpc', 'id', 'method'],
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'JSON-RPC response',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    jsonrpc: { type: 'string', example: '2.0' },
                                    id: { type: 'integer', example: 1 },
                                    result: { type: 'object' },
                                    error: { type: 'object' },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
    '/mcp/methods': {
        get: {
            summary: 'List all available MCP methods',
            description: 'Returns a list of all available MCP methods and their parameters.',
            responses: {
                200: {
                    description: 'A list of MCP methods',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    methods: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                name: { type: 'string' },
                                                description: { type: 'string' },
                                                parameters: {
                                                    type: 'array',
                                                    items: { type: 'string' },
                                                },
                                            },
                                        },
                                    },
                                    total: { type: 'integer' },
                                    timestamp: { type: 'string', format: 'date-time' },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
};
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
app.get('/openapi.json', (req, res) => { res.json(openapiSpec); });
export async function startGateway() {
    app.listen(GATEWAY_PORT, () => {
        // eslint-disable-next-line no-console
        console.error(`🚀 AEM MCP Gateway Server running on port ${GATEWAY_PORT}`);
    });
}
