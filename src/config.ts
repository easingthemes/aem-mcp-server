const APP_VERSION = process.env.npm_package_version || '1.0.0';

export const config = {
  APP_VERSION,
  MCP_USERNAME: process.env.MCP_USERNAME || '',
  MCP_PASSWORD: process.env.MCP_PASSWORD || '',
  MCP_PORT: parseInt(process.env.MCP_PORT || '8502', 10),
}
