import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { SynthesizeResult } from './PiperClient.js';

function pcmToWav(pcm: Buffer, sampleRate = 8000, channels = 1, bitDepth = 16): Buffer {
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

export class ElevenLabsClient {
  private readonly baseUrl = 'https://api.elevenlabs.io/v1';

  constructor(
    private readonly apiKey: string,
    private readonly voiceId: string,
    private readonly modelId: string,
    private readonly audioDir: string,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async synthesize(text: string, outputFilename: string): Promise<SynthesizeResult> {
    const start = Date.now();
    const outputPath = path.join(this.audioDir, outputFilename);
    fs.mkdirSync(this.audioDir, { recursive: true });

    const response = await fetch(
      `${this.baseUrl}/text-to-speech/${this.voiceId}?output_format=pcm_8000`,
      {
        method: 'POST',
        headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: this.modelId,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs error ${response.status}: ${await response.text()}`);
    }

    const pcm = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, pcmToWav(pcm));

    const durationMs = Date.now() - start;
    this.logger.debug({ outputPath, durationMs }, 'ElevenLabs TTS complete');
    return { audioPath: outputPath, durationMs };
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/user`, {
        headers: { 'xi-api-key': this.apiKey },
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
