/**
 * Logger utility.
 * - warn/error: always write to stderr (safe for stdio transport)
 * - log/info: gated behind MCP_LOGGER env var (writes to stdout, would corrupt stdio transport)
 */

const link = (text: string, url: string) => {
  return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}
function getCallerInfo() {
  const err = new Error();
  const stack = err.stack?.split('\n') || [];
  // stack[0] = Error, stack[1] = this function, stack[2] = logger method, stack[3] = caller
  const callerLine = stack[3] || '';
  // Extract file:line info
  const match = callerLine.match(/\(([^)]+)\)/);
  const fileLine = match ? match[1] : callerLine.trim();
  const name = fileLine.split('/').pop() || 'unknown';
  return link(`${name}`, `${fileLine}`);
}

const ENABLE_LOGGER = !!process.env.MCP_LOGGER;

export const LOGGER = {
  log: (...args: any[]) => {
    if (ENABLE_LOGGER) {
      console.log(`[${getCallerInfo()}]`, ...args);
    }
  },
  info: (...args: any[]) => {
    if (ENABLE_LOGGER) {
      console.info(`[${getCallerInfo()}]`, ...args);
    }
  },
  warn: (...args: any[]) => {
    // Always write warnings to stderr (safe for stdio transport)
    console.warn(`[${getCallerInfo()}]`, ...args);
  },
  error: (...args: any[]) => {
    // Always write errors to stderr (safe for stdio transport)
    console.error(`[${getCallerInfo()}]`, ...args);
  },
};
