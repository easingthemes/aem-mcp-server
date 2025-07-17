import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';
import { Express, Request, Response } from 'express';
import { config } from '../config.js';
import { apiPaths } from './api.spec.js';

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'AEM MCP Gateway API',
    version: '1.0.0',
    description: 'API documentation for the AEM MCP Gateway Server',
  },
  servers: [
    { url: `http://localhost:${config.SERVER_PORT}` },
  ],
};

const options = {
  swaggerDefinition,
  apis: [],
};

const openapiSpec: any = swaggerJSDoc(options);
openapiSpec.paths = apiPaths;

export const useExplorer = (app: Express) => {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
  app.get('/openapi.json', (req: Request, res: Response) => { res.json(openapiSpec); });
}
