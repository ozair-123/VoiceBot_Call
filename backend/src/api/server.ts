import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import path from 'node:path';
import { env } from '../config/env.js';
import { healthRoutes } from './routes/health.js';
import { testRoutes } from './routes/test.js';
import type { Container } from '../container.js';

export async function buildServer(container: Container) {
  const loggerConfig =
    env.NODE_ENV === 'development'
      ? { level: env.LOG_LEVEL, transport: { target: 'pino-pretty', options: { colorize: true } } }
      : { level: env.LOG_LEVEL };

  const app = Fastify({ logger: loggerConfig });

  await app.register(fastifyMultipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  // Serve TTS audio files (used during development/testing)
  await app.register(fastifyStatic, {
    root: path.resolve(container.audioDir),
    prefix: '/api/audio/files/',
  });

  await app.register(healthRoutes, { prefix: '/api', container });
  await app.register(testRoutes, { prefix: '/api/test', container });

  app.setErrorHandler((error, _req, reply) => {
    app.log.error(error);
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    reply.status(statusCode).send({ error: error.message ?? 'Internal server error' });
  });

  return app;
}
