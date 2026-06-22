import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { SynthesizeResult } from './PiperClient.js';

const VOICES: Record<string, { languageCode: string; name?: string; gender: string }> = {
  en: { languageCode: 'en-US', name: 'en-US-Neural2-F', gender: 'FEMALE' },
  ur: { languageCode: 'ur-PK', gender: 'FEMALE' },
};

export class GoogleTTSClient {
  private readonly endpoint = 'https://texttospeech.googleapis.com/v1/text:synthesize';

  constructor(
    private readonly apiKey: string,
    private readonly audioDir: string,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async synthesize(text: string, outputFilename: string, language = 'en'): Promise<SynthesizeResult> {
    const start = Date.now();
    const outputPath = path.join(this.audioDir, outputFilename);
    fs.mkdirSync(this.audioDir, { recursive: true });

    const voice = VOICES[language] ?? VOICES['en']!;

    const response = await fetch(`${this.endpoint}?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: voice.languageCode,
          ...(voice.name ? { name: voice.name } : { ssmlGender: voice.gender }),
        },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 8000 },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Google TTS error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as { audioContent: string };
    const wav = Buffer.from(data.audioContent, 'base64');
    fs.writeFileSync(outputPath, wav);

    const durationMs = Date.now() - start;
    this.logger.debug({ outputPath, language, durationMs }, 'Google TTS complete');
    return { audioPath: outputPath, durationMs };
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(
        `https://texttospeech.googleapis.com/v1/voices?key=${this.apiKey}`,
        { signal: AbortSignal.timeout(5_000) },
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
