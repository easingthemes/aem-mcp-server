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
  cert: {
    type: 'string',
    alias: 'C',
    default: process.env.AEM_CERT_PATH,
    describe: 'Client certificate PEM for mTLS to AEM (env AEM_CERT_PATH). Requires --key',
  },
  key: {
    type: 'string',
    alias: 'k',
    default: process.env.AEM_KEY_PATH,
    describe: 'Client private key PEM (env AEM_KEY_PATH). Passphrase via env AEM_KEY_PASSPHRASE only',
  },
  ca: {
    type: 'string',
    default: process.env.AEM_CA_PATH,
    describe: 'CA bundle PEM for the AEM server certificate (env AEM_CA_PATH)',
  },
})
  .help()
  .alias('h', 'help')
  .parseSync();

if (argv.help) {
  process.exit(0);
}

const { host, user, pass, mcpPort, id, secret, transport, instances, cert, key, ca } = argv;
const params: CliParams = { host, user, pass, mcpPort, id, secret, instances, cert, key, ca };

if (transport === 'stdio') {
  startStdio(params);
} else {
  startServer(params);
}
