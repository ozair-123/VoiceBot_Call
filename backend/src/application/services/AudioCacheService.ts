import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { TTSService } from './TTSService.js';
import type { SSHFileTransferService } from '../../infrastructure/external/SSHFileTransferService.js';
import { GREETING_EN, FILLER_PHRASE, TRANSFER_PHRASE, ERROR_PHRASE } from '../../config/constants.js';

const PHRASES = {
  greeting: { text: GREETING_EN, language: 'en' },
  filler:   { text: FILLER_PHRASE, language: 'en' },
  transfer: { text: TRANSFER_PHRASE, language: 'en' },
  error:    { text: ERROR_PHRASE, language: 'en' },
} as const;

export type CacheKey = keyof typeof PHRASES;

export class AudioCacheService {
  private remotePaths = new Map<CacheKey, string>();

  constructor(
    private readonly ttsService: TTSService,
    private readonly sshTransfer: SSHFileTransferService,
    private readonly localAudioDir: string,
    private readonly asteriskTmpDir: string,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async warmUp(): Promise<void> {
    this.logger.info('Pre-caching common audio phrases');
    for (const [key, { text, language }] of Object.entries(PHRASES) as [CacheKey, { text: string; language: string }][]) {
      try {
        const filename = `voicebot-cache-${key}.wav`;
        const localPath = path.join(this.localAudioDir, filename);
        const remotePath = path.posix.join(this.asteriskTmpDir, `voicebot-cache-${key}`);

        await this.ttsService.synthesizeToPath(text, filename, language);
        await this.sshTransfer.upload(localPath, `${remotePath}.wav`);

        this.remotePaths.set(key, remotePath);
        this.logger.info({ key }, 'Audio phrase cached');
      } catch (err) {
        this.logger.warn({ err, key }, 'Failed to cache audio phrase — will generate on demand');
      }
    }
  }

  getRemotePath(key: CacheKey): string | null {
    return this.remotePaths.get(key) ?? null;
  }
}
