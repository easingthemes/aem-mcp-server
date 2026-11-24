import { createHash, timingSafeEqual } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

/**
 * Who may call the MCP endpoint.
 *
 * The server acts on AEM with the credentials it was started with, so whoever
 * reaches `/mcp` can read, change, delete and publish content as that user.
 *
 * - MCP_USERNAME + MCP_PASSWORD set: every request needs HTTP Basic auth.
 * - Otherwise the server is for this machine only: it listens on loopback and
 *   answers only requests addressed to a local name (`Host`) that do not come
 *   from another web origin (`Origin`). Without that, any web page open in the
 *   developer's browser could call the endpoint (cross-origin requests, DNS
 *   rebinding).
 *
 * Pure functions, no Express, so they can be unit-tested.
 */

export type Credentials = { username: string; password: string };

export type GuardInput = {
  host?: string;
  origin?: string;
  authorization?: string;
  credentials?: Credentials | null;
};

export type Refusal = { status: 401 | 403; error: string };

const isLoopbackAddress = (ip: string): boolean => {
  if (isIPv4(ip)) return ip.startsWith('127.');
  if (isIPv6(ip)) return ip === '::1';
  return false;
};

/** A Host header ("localhost:8502", "[::1]:8502") or Origin ("http://localhost:6274") naming this machine. */
export const isLocalName = (value: string | undefined): boolean => {
  if (!value) return false;
  let hostname: string;
  try {
    hostname = new URL(value.includes('://') ? value : `http://${value}`).hostname;
  } catch {
    return false;
  }
  hostname = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return hostname === 'localhost' || isLoopbackAddress(hostname);
};

const sameSecret = (presented: string, expected: string): boolean => {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
};

/** Basic auth check. The password may contain ':' (only the first one separates). */
export const basicAuthMatches = (authorization: string | undefined, credentials: Credentials): boolean => {
  if (!authorization || !authorization.startsWith('Basic ')) return false;
  const decoded = Buffer.from(authorization.slice(6), 'base64').toString();
  const colon = decoded.indexOf(':');
  if (colon === -1) return false;
  // Evaluate both comparisons so timing does not show which one failed.
  const userOk = sameSecret(decoded.slice(0, colon), credentials.username);
  const passOk = sameSecret(decoded.slice(colon + 1), credentials.password);
  return userOk && passOk;
};

/** Configured MCP credentials, or null when either half is missing. */
export const configuredCredentials = (username?: string, password?: string): Credentials | null =>
  username && password ? { username, password } : null;

/** Why the request must be refused, or null when it may proceed. */
export const refusal = ({ host, origin, authorization, credentials }: GuardInput): Refusal | null => {
  if (credentials) {
    return basicAuthMatches(authorization, credentials)
      ? null
      : { status: 401, error: 'Authentication required' };
  }
  if (!isLocalName(host)) {
    return { status: 403, error: 'This server only answers local requests. Set MCP_USERNAME and MCP_PASSWORD to use it from elsewhere.' };
  }
  if (origin !== undefined && !isLocalName(origin)) {
    return { status: 403, error: 'Requests from other web origins are refused.' };
  }
  return null;
};

/** CORS: only pages served from this machine (for example a local MCP inspector) may read responses. */
export const corsOriginAllowed = (origin: string | undefined): boolean => origin === undefined || isLocalName(origin);

/** Where to listen: loopback unless credentials protect the endpoint or the operator chose a host. */
export const listenHost = (requested: string | undefined, credentials: Credentials | null): string | undefined => {
  if (requested) return requested;
  return credentials ? undefined : '127.0.0.1';
};
