const SERVER_PORT = parseInt(process.env.SERVER_PORT || '3000', 10);
const MCP_PORT = parseInt(process.env.MCP_PORT || '8080', 10);
const MCP_USERNAME = process.env.MCP_USERNAME || 'admin';
const MCP_PASSWORD = process.env.MCP_PASSWORD || 'admin';
const APP_VERSION = process.env.npm_package_version || '1.0.0';

export const config = {
  SERVER_PORT,
  MCP_USERNAME,
  MCP_PASSWORD,
  APP_VERSION
}
