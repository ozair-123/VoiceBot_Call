import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../config/env.js';
import type { Container } from '../../container.js';

export const healthRoutes: FastifyPluginAsync<{ container: Container }> = async (
  app,
  { container },
) => {
  app.get('/health', async (_req, reply) => {
    const [llmOk, whisperOk, ttsOk] = await Promise.all([
      container.openaiClient.checkHealth(),
      container.whisperClient.checkHealth(),
      container.ttsService.checkHealth(),
    ]);

    const status = llmOk && whisperOk && ttsOk ? 'ok' : 'degraded';

    return reply.status(status === 'ok' ? 200 : 207).send({
      status,
      services: {
        llm: llmOk ? 'ok' : 'unavailable',
        llmProvider: 'openai',
        whisper: whisperOk ? 'ok' : 'unavailable',
        tts: ttsOk ? 'ok' : 'unavailable',
        ttsProvider: env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'piper',
      },
      activeCalls: container.callSessionService.activeCallCount,
      timestamp: new Date().toISOString(),
    });
  });
};
