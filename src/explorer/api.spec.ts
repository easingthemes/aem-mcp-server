export const apiPaths = {
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
