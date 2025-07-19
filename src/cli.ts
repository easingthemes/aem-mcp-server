#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { startServer } from './index.js';
import { CliParams } from './types';

type CliArgs = CliParams & {
  help?: boolean;
};

const argv: CliArgs = yargs(hideBin(process.argv)).options({
  host: { type: 'string', default: 'http://localhost:4502', alias: 'H' },
  user: { type: 'string', default: 'admin', alias: 'u' },
  pass: { type: 'string', default: 'admin', alias: 'p' },
  mcpPort: { type: 'number', default: 3000, alias: 'm' }
})
  .help()
  .alias('h', 'help')
  .parseSync();

if (argv.help) {
  process.exit(0); // prevent startServer from running
}

const { host, user, pass, mcpPort } = argv;
startServer({ host, user, pass, mcpPort });
