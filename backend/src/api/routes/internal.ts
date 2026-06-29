import type { FastifyInstance } from 'fastify';
import type { Container } from '../../container.js';

export async function internalRoutes(app: FastifyInstance, _opts: { container: Container }) {
  // Queried by Asterisk AGI (did_lookup.sh) for every inbound call.
  // Returns routing decision: send call to voicebot AI first, then human queue on transfer.
  app.get('/route-inbound', async (req, reply) => {
    const { did } = req.query as { did?: string };

    app.log.info({ did }, 'DID route-inbound lookup');

    if (!did) {
      return reply.send({ extension: '', route_type: 'extension', members: [] });
    }

    // All inbound calls go through the AI voicebot first.
    // When AudioSocket ends (transfer or hangup), Asterisk falls through to Queue(support).
    return reply.send({
      extension: 'Local/s@voicebot-ai',
      route_type: 'queue',
      members: [],
    });
  });
}
