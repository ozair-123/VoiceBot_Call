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

  async transcribe(audioFilePath: string, mimeType?: string, language?: string): Promise<TranscribeResult> {
    const start = Date.now();
    const fileBuffer = fs.readFileSync(audioFilePath);

    const ext = audioFilePath.split('.').pop()?.toLowerCase() ?? 'wav';
    const contentTypeMap: Record<string, string> = {
      wav: 'audio/wav', webm: 'audio/webm;codecs=opus', ogg: 'audio/ogg',
      mp3: 'audio/mpeg', mp4: 'audio/mp4', m4a: 'audio/mp4',
    };
    const contentType = mimeType ?? contentTypeMap[ext] ?? 'audio/wav';

    const url = new URL(this.endpoint);
    url.searchParams.set('model', this.model);
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('punctuate', 'true');
    if (language) {
      url.searchParams.set('language', language);
    } else {
      url.searchParams.set('detect_language', 'true');
    }

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': contentType,
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
