import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { SynthesizeResult } from '../../infrastructure/external/PiperClient.js';

export interface ITTSBackend {
  synthesize(text: string, outputFilename: string, language?: string): Promise<SynthesizeResult>;
  checkHealth(): Promise<boolean>;
}

export class TTSService {
  constructor(
    private readonly englishBackend: ITTSBackend,
    private readonly urduBackend: ITTSBackend,
    private readonly audioDir: string,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async synthesize(text: string, language = 'en'): Promise<SynthesizeResult> {
    const filename = `tts-${uuidv4()}.wav`;
    const backend = language === 'ur' ? this.urduBackend : this.englishBackend;
    const provider = backend.constructor.name.replace('Client', '').toLowerCase();

    this.logger.info({ textLength: text.length, filename, language, provider }, 'Starting TTS synthesis');
    const result = await backend.synthesize(text, filename, language);
    this.logger.info({ filename, durationMs: result.durationMs, provider }, 'TTS synthesis complete');
    return result;
  }

  async checkHealth(): Promise<boolean> {
    const [enOk, urOk] = await Promise.all([
      this.englishBackend.checkHealth(),
      this.urduBackend.checkHealth(),
    ]);
    return enOk && urOk;
  }

  getRelativeFilename(audioPath: string): string {
    return path.basename(audioPath);
  }
}
