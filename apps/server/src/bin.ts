import { loadConfig, ConfigError } from './config.js';
import { openDatabase } from './db/index.js';
import { buildApp } from './app.js';
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
  const app = buildApp({ db: database.db });
  app.listen({ port: config.port, host: config.host }).then(
    () => {
      logger.info('server listening', { host: config.host, port: config.port });
    },
    () => {
      logger.error('server failed to start');
      process.exit(1);
    },
  );

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    logger.info('shutting down', { signal });
    void app.close().finally(() => {
      database.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

main();
