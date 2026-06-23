import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { FastifyBaseLogger } from 'fastify';
import type { AsteriskFastAGIServer, AGICall } from '../../infrastructure/external/AsteriskFastAGIServer.js';
import type { SSHFileTransferService } from '../../infrastructure/external/SSHFileTransferService.js';
import type { ICallRepository } from '../../domain/repositories/ICallRepository.js';
import type { STTService } from './STTService.js';
import type { TTSService } from './TTSService.js';
import type { LLMService, ChatMessage } from './LLMService.js';
import type { QueueTransferService } from './QueueTransferService.js';
import type { AudioCacheService } from './AudioCacheService.js';
import type { CallOutcome } from '../../domain/entities/Call.js';
import { GREETING_EN, GREETING_UR, FILLER_PHRASE, ERROR_PHRASE } from '../../config/constants.js';

interface CallSession {
  callId: string;
  history: ChatMessage[];
  startedAt: number;
  active: boolean;
  language: string;
}

export class CallSessionService {
  private activeCalls = 0;

  constructor(
    private readonly agiServer: AsteriskFastAGIServer,
    private readonly sshTransfer: SSHFileTransferService,
    private readonly callRepo: ICallRepository,
    private readonly sttService: STTService,
    private readonly ttsService: TTSService,
    private readonly llmService: LLMService,
    private readonly transferService: QueueTransferService,
    private readonly audioCache: AudioCacheService,
    private readonly asteriskTmpDir: string,
    private readonly localTmpDir: string,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.agiServer.on('call', (call: AGICall) => {
      this.handleCall(call).catch((err: unknown) => {
        this.logger.error({ err }, 'Unhandled call error');
      });
    });
  }

  private async handleCall(call: AGICall): Promise<void> {
    this.activeCalls++;
    const callId = uuidv4();
    const channelId = call.variables['channel'] ?? 'unknown';
    const callerId = call.variables['callerid'] ?? null;

    const session: CallSession = {
      callId,
      history: [],
      startedAt: Date.now(),
      active: true,
      language: 'en',
    };

    call.once('hangup', () => { session.active = false; });

    await this.callRepo.create({ id: callId, channelId, callerId, startedAt: session.startedAt });
    this.logger.info({ callId, channelId, callerId }, 'Call started');

    try {
      await call.answer();

      // Play greeting — use pre-cached file if available
      const greetingPath = this.audioCache.getRemotePath('greeting');
      if (greetingPath) {
        await call.streamFile(greetingPath);
      } else {
        await this.playTTS(call, GREETING_EN, 'en');
        await this.playTTS(call, GREETING_UR, 'ur');
      }

      let noSpeechStreak = 0;
      let lastTranscript = '';

      while (session.active) {
        const recordingBase = `voicebot-${callId}-${Date.now()}`;
        const remoteRecPath = path.posix.join(this.asteriskTmpDir, recordingBase);
        const localRecPath = path.join(this.localTmpDir, `${recordingBase}.wav`);

        await call.recordFile(remoteRecPath);
        if (!session.active) break;

        try {
          await this.sshTransfer.download(`${remoteRecPath}.wav`, localRecPath);
          this.sshTransfer.deleteRemote(`${remoteRecPath}.wav`).catch(() => {});
        } catch (err) {
          this.logger.error({ err }, 'Failed to download recording');
          break;
        }

        // STT
        let transcript = '';
        let confidence = 0;
        let sttDurationMs = 0;

        try {
          const sttResult = await this.sttService.transcribeFile(localRecPath);
          transcript = sttResult.text;
          sttDurationMs = sttResult.durationMs;
          confidence = this.scoreConfidence(transcript);
          if (sttResult.language) {
            session.language = sttResult.language === 'hi' ? 'ur' : sttResult.language;
          }
          this.logger.info({ transcript, confidence, sttDurationMs, language: session.language }, 'STT complete');
        } catch (err) {
          this.logger.error({ err }, 'STT failed');
          break;
        } finally {
          this.sttService.deleteFile(localRecPath);
        }

        await this.callRepo.addTranscript({
          id: uuidv4(), callId, role: 'user',
          content: transcript || '(no speech)', confidence, durationMs: sttDurationMs,
        });

        // No speech — transfer after 2 consecutive silent turns
        if (confidence < 0.4) {
          noSpeechStreak++;
          if (noSpeechStreak >= 2) {
            this.logger.info({ callId }, 'Repeated no-speech — transferring');
            await this.transferService.transfer(call, session.history);
            await this.endCall(session, 'no_speech');
            return;
          }
          continue;
        }
        noSpeechStreak = 0;

        // Loop detection — same question repeated
        if (transcript === lastTranscript) {
          this.logger.info({ callId }, 'Repeated question — transferring');
          await this.transferService.transfer(call, session.history);
          await this.endCall(session, 'transferred', 'Repeated question');
          return;
        }
        lastTranscript = transcript;

        // Play filler while LLM processes — run both in parallel
        const fillerPath = this.audioCache.getRemotePath('filler');
        let responseText = '';

        if (fillerPath && session.active) {
          const [, llmResult] = await Promise.all([
            call.streamFile(fillerPath),
            this.llmService.sendMessage(session.history, transcript).catch((err) => {
              this.logger.error({ err }, 'LLM failed');
              return null as string | null;
            }),
          ]);
          responseText = llmResult ?? '';
        } else {
          try {
            responseText = await this.llmService.sendMessage(session.history, transcript);
          } catch (err) {
            this.logger.error({ err }, 'LLM failed');
          }
        }

        // LLM error — play error message and transfer
        if (!responseText) {
          const errorPath = this.audioCache.getRemotePath('error');
          if (errorPath) await call.streamFile(errorPath).catch(() => {});
          else await this.playTTS(call, ERROR_PHRASE, 'en');
          await this.transferService.transfer(call, session.history);
          await this.endCall(session, 'transferred', 'LLM error');
          return;
        }

        session.history.push({ role: 'user', content: transcript });
        session.history.push({ role: 'assistant', content: responseText });
        if (session.history.length > 20) session.history.splice(0, 2);

        await this.callRepo.addTranscript({
          id: uuidv4(), callId, role: 'assistant', content: responseText,
        });

        // Escalation check
        if (this.transferService.shouldTransfer(responseText)) {
          await this.transferService.transfer(call, session.history);
          await this.endCall(session, 'transferred', 'Escalation keyword detected');
          return;
        }

        await this.playTTS(call, responseText, session.language);
      }

      await this.endCall(session, 'answered');
    } catch (err) {
      this.logger.error({ err, callId }, 'Call session error');
      await this.endCall(session, 'dropped');
    } finally {
      this.activeCalls--;
      call.destroy();
    }
  }

  private async playTTS(call: AGICall, text: string, language = 'en'): Promise<void> {
    try {
      const result = await this.ttsService.synthesize(text, language);
      const localPath = result.audioPath;
      const filename = path.basename(localPath, '.wav');
      const remotePath = path.posix.join(this.asteriskTmpDir, filename);

      // Upload TTS file to Asterisk server
      await this.sshTransfer.upload(localPath, `${remotePath}.wav`);

      // Play it (Asterisk STREAM FILE omits extension)
      await call.streamFile(remotePath);

      // Clean up both sides
      this.sshTransfer.deleteRemote(`${remotePath}.wav`).catch(() => {});
      this.sttService.deleteFile(localPath);
    } catch (err) {
      this.logger.warn({ err, text: text.slice(0, 60) }, 'TTS playback failed');
    }
  }

  private scoreConfidence(transcript: string): number {
    const words = transcript.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return 0.0;
    if (words.length < 3) return 0.3;
    return 0.8;
  }

  private async endCall(session: CallSession, outcome: CallOutcome, transferReason?: string): Promise<void> {
    session.active = false;
    await this.callRepo.close(session.callId, outcome, transferReason).catch((err: unknown) => {
      this.logger.error({ err }, 'Failed to close call record');
    });
    this.logger.info(
      { callId: session.callId, outcome, durationMs: Date.now() - session.startedAt },
      'Call ended',
    );
  }

  get activeCallCount(): number {
    return this.activeCalls;
  }
}
