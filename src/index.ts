import { config } from './config.js';
import { startServer } from './server/app.server.js';

startServer(config.SERVER_PORT);
