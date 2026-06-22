import fs from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';

export interface TranscribeResult {
  text: string;
  language: string;
  durationMs: number;
}

export class WhisperClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async transcribe(audioFilePath: string): Promise<TranscribeResult> {
    const start = Date.now();
    const url = `${this.baseUrl}/transcribe`;

    const fileBuffer = fs.readFileSync(audioFilePath);
    const blob = new Blob([fileBuffer]);
    const form = new FormData();
    form.append('file', blob, 'audio.wav');

    this.logger.debug({ audioFilePath, url }, 'Sending audio to Whisper');

    const response = await fetch(url, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Whisper error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as { text: string; language?: string };
    const durationMs = Date.now() - start;

    this.logger.debug({ text: data.text, durationMs }, 'Transcription complete');

    return {
      text: data.text.trim(),
      language: data.language ?? 'en',
      durationMs,
    };
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
