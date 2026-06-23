import fs from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import type { TranscribeResult } from './WhisperClient.js';

interface DeepgramResponse {
  results: {
    channels: Array<{
      alternatives: Array<{ transcript: string; confidence: number }>;
      detected_language?: string;
    }>;
  };
}

export class DeepgramClient {
  private readonly endpoint = 'https://api.deepgram.com/v1/listen';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async transcribe(audioFilePath: string): Promise<TranscribeResult> {
    const start = Date.now();
    const fileBuffer = fs.readFileSync(audioFilePath);

    const url = new URL(this.endpoint);
    url.searchParams.set('model', this.model);
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('detect_language', 'true');
    url.searchParams.set('punctuate', 'true');

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'audio/wav',
      },
      body: fileBuffer,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Deepgram error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as DeepgramResponse;
    const channel = data.results.channels[0];
    const alt = channel?.alternatives[0];

    return {
      text: alt?.transcript?.trim() ?? '',
      language: channel?.detected_language ?? 'en',
      durationMs: Date.now() - start,
    };
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch('https://api.deepgram.com/v1/projects', {
        headers: { 'Authorization': `Token ${this.apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
