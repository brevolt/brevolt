import { loadConfig, ConfigError } from './config.js';
import { openDatabase } from './db/index.js';
import { createHttpServer } from './http.js';
import { createLogger } from './logger.js';

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // ConfigError messages list variable names only, never values.
    process.stderr.write(
      `${error instanceof ConfigError ? error.message : 'Invalid configuration'}\n`,
    );
    process.exit(1);
  }
  const logger = createLogger({ level: config.logLevel });
  const database = openDatabase({
    path: config.databasePath,
    onBackup: () => {
      logger.info('pre-migration backup created');
    },
  });
  const server = createHttpServer();
  server.listen(config.port, config.host, () => {
    logger.info('server listening', { host: config.host, port: config.port });
  });

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    logger.info('shutting down', { signal });
    server.close(() => {
      database.close();
      process.exit(0);
    });
    server.closeAllConnections();
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

main();
