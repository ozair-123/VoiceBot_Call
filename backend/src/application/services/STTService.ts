import path from 'node:path';
import fs from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import type { TranscribeResult } from '../../infrastructure/external/WhisperClient.js';

export interface ISTTClient {
  transcribe(audioFilePath: string, mimeType?: string, language?: string): Promise<TranscribeResult>;
}

export class STTService {
  constructor(
    private readonly whisperClient: ISTTClient,
    private readonly audioDir: string,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async transcribeFile(audioFilePath: string, mimeType?: string, language?: string): Promise<TranscribeResult> {
    this.logger.info({ audioFilePath }, 'Starting transcription');
    const result = await this.whisperClient.transcribe(audioFilePath, mimeType, language);
    this.logger.info({ text: result.text, durationMs: result.durationMs }, 'Transcription done');
    return result;
  }

  async saveUploadedAudio(buffer: Buffer, filename: string): Promise<string> {
    fs.mkdirSync(this.audioDir, { recursive: true });
    const filePath = path.join(this.audioDir, filename);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  deleteFile(filePath: string): void {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // best-effort cleanup
    }
  }
}
