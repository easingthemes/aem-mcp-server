// Map to store transports by session ID
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

