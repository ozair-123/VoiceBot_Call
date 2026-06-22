import { buildContainer } from './container.js';
import { buildServer } from './api/server.js';
import { env } from './config/env.js';

async function main() {
  const container = await buildContainer();
  const app = await buildServer(container);

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`HTTP server listening on http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err, 'HTTP server failed to start');
    process.exit(1);
  }

  // Start FastAGI TCP server (Asterisk connects here per inbound call)
  await container.agiServer.listen();

  const shutdown = async () => {
    app.log.info('Shutting down...');
    await container.agiServer.close();
    await app.close();
    await container.db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
