const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const { startServer } = require('../dist/index.js');

const argv = yargs(hideBin(process.argv)).options({
  host: { type: 'string', default: 'http://localhost:4502' },
  user: { type: 'string', default: 'admin' },
  pass: { type: 'string', default: 'admin' },
  mcpPort: { type: 'number', default: 3000 },
  explorer: { type: 'boolean', default: false },
})
  .help()
  .alias('h', 'help')
  .argv;

if (argv.help) {
  process.exit(0); // prevent startServer from running
}

const { host, user, pass, mcpPort, explorer } = argv;
startServer({ host, user, pass, mcpPort, explorer });
