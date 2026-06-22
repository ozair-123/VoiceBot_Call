import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { AGICall } from '../../infrastructure/external/AsteriskFastAGIServer.js';
import type { SSHFileTransferService } from '../../infrastructure/external/SSHFileTransferService.js';
import type { TTSService } from './TTSService.js';
import type { ChatMessage } from './LLMService.js';
import { ESCALATION_KEYWORDS, TRANSFER_PHRASE } from '../../config/constants.js';

export class QueueTransferService {
  constructor(
    private readonly sshTransfer: SSHFileTransferService,
    private readonly ttsService: TTSService,
    private readonly asteriskTmpDir: string,
    private readonly logger: FastifyBaseLogger,
  ) {}

  shouldTransfer(responseText: string): boolean {
    const lower = responseText.toLowerCase();
    return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
  }

  async transfer(call: AGICall, _history: ChatMessage[]): Promise<void> {
    this.logger.info({ channel: call.variables['channel'] }, 'Transferring call to queue');

    try {
      const result = await this.ttsService.synthesize(TRANSFER_PHRASE);
      const localPath = result.audioPath;
      const filename = path.basename(localPath, '.wav');
      const remotePath = path.posix.join(this.asteriskTmpDir, filename);

      await this.sshTransfer.upload(localPath, `${remotePath}.wav`);
      await call.streamFile(remotePath).catch(() => {});
      this.sshTransfer.deleteRemote(`${remotePath}.wav`).catch(() => {});
    } catch (err) {
      this.logger.warn({ err }, 'Transfer message TTS failed — hanging up');
    }

    // Close the AGI socket — Asterisk continues dialplan to Queue()
    call.destroy();
  }
}
