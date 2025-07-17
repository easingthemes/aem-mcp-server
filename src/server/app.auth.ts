import { Express, NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

const { MCP_USERNAME, MCP_PASSWORD } = config;

/**
 * Basic Authentication middleware for MCP routes.
 * Uses environment variables MCP_USERNAME and MCP_PASSWORD for credentials.
 * If these variables are not set, defaults to 'admin' for both username and password.
 */
const basicAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
  const [username, password] = credentials.split(':');
  const validUsername = MCP_USERNAME || 'admin';
  const validPassword = MCP_PASSWORD || 'admin';
  if (username !== validUsername || password !== validPassword) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  next();
};

export const useBasicAuth = (app: Express) => {
  if (MCP_USERNAME && MCP_PASSWORD) {
    app.use('/mcp', basicAuth);
  }
}
