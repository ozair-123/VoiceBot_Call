import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { MAX_AUDIO_SIZE_BYTES } from '../../config/constants.js';

export async function registerMultipart(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: MAX_AUDIO_SIZE_BYTES,
      files: 1,
    },
  });
}
