import type { FastifyBaseLogger } from 'fastify';
import type { OpenAIClient } from '../../infrastructure/external/OpenAIClient.js';
import { SYSTEM_PROMPT, MAX_HISTORY_EXCHANGES } from '../../config/constants.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class LLMService {
  constructor(
    private readonly openaiClient: OpenAIClient,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async sendMessage(history: ChatMessage[], userContent: string): Promise<string> {
    const trimmedHistory = history.slice(-(MAX_HISTORY_EXCHANGES * 2));

    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      ...trimmedHistory.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: userContent },
    ];

    const start = Date.now();

    try {
      const response = await this.openaiClient.chat(messages);
      const durationMs = Date.now() - start;
      this.logger.info({ durationMs, responseLength: response.length }, 'LLM response complete');
      return response;
    } catch (err) {
      this.logger.error({ err }, 'LLM error');
      throw err;
    }
  }
}
