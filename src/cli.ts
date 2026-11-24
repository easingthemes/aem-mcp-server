#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { startServer } from './index.js';
import { startStdio } from './mcp/mcp.stdio.js';
import { CliParams } from './types';

const argv = yargs(hideBin(process.argv)).options({
  host: { type: 'string', default: 'http://localhost:4502', alias: 'H' },
  user: { type: 'string', default: 'admin', alias: 'u' },
  pass: { type: 'string', default: 'admin', alias: 'p' },
  id: { type: 'string', default: '', alias: 'i', describe: 'clientId' },
  secret: { type: 'string', default: '', alias: 's', describe: 'clientSecret' },
  mcpPort: { type: 'number', default: 8502, alias: 'm' },
  mcpHost: {
    type: 'string',
    describe: 'Address to listen on. Default: 127.0.0.1, or all interfaces when MCP_USERNAME and MCP_PASSWORD are set',
  },
  transport: {
    type: 'string',
    default: 'http' as const,
    alias: 't',
    describe: 'Transport mode: http (default) or stdio',
    choices: ['http', 'stdio'] as const,
  },
  instances: {
    type: 'string',
    default: '',
    alias: 'I',
    describe: 'Named AEM instances: "local:http://localhost:4502:admin:admin,qa:https://qa.example.com:user:pass"',
  },
})
  .help()
  .alias('h', 'help')
  .parseSync();

if (argv.help) {
  process.exit(0);
}

const { host, user, pass, mcpPort, mcpHost, id, secret, transport, instances } = argv;
const params: CliParams = { host, user, pass, mcpPort, mcpHost, id, secret, instances };

if (transport === 'stdio') {
  startStdio(params);
} else {
  startServer(params);
}
