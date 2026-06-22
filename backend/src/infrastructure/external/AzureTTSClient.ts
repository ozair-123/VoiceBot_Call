import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { SynthesizeResult } from './PiperClient.js';

const VOICES: Record<string, string> = {
  ur: 'ur-PK-UzmaNeural',
  en: 'en-US-JennyNeural',
};

const LANG_CODES: Record<string, string> = {
  ur: 'ur-PK',
  en: 'en-US',
};

export class AzureTTSClient {
  private readonly endpoint: string;

  constructor(
    private readonly apiKey: string,
    private readonly region: string,
    private readonly audioDir: string,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  }

  async synthesize(text: string, outputFilename: string, language = 'en'): Promise<SynthesizeResult> {
    const start = Date.now();
    const outputPath = path.join(this.audioDir, outputFilename);
    fs.mkdirSync(this.audioDir, { recursive: true });

    const voice = VOICES[language] ?? VOICES['en']!;
    const langCode = LANG_CODES[language] ?? LANG_CODES['en']!;

    const ssml = `<speak version='1.0' xml:lang='${langCode}'><voice name='${voice}'>${text}</voice></speak>`;

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.apiKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-8khz-16bit-mono-pcm',
        'User-Agent': 'SynergyTalkVoiceBot',
      },
      body: ssml,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Azure TTS error ${response.status}: ${await response.text()}`);
    }

    const wav = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, wav);

    const durationMs = Date.now() - start;
    this.logger.debug({ outputPath, language, durationMs }, 'Azure TTS complete');
    return { audioPath: outputPath, durationMs };
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(
        `https://${this.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
        {
          method: 'POST',
          headers: { 'Ocp-Apim-Subscription-Key': this.apiKey },
          signal: AbortSignal.timeout(5_000),
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
