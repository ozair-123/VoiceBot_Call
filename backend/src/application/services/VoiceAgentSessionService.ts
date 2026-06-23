import { v4 as uuidv4 } from 'uuid';
import type { FastifyBaseLogger } from 'fastify';
import type { AudioSocketServer, AudioSocketSession } from '../../infrastructure/external/AudioSocketServer.js';
import type { ICallRepository } from '../../domain/repositories/ICallRepository.js';
import { DeepgramVoiceAgentClient } from '../../infrastructure/external/DeepgramVoiceAgentClient.js';

export class VoiceAgentSessionService {
  constructor(
    audioSocketServer: AudioSocketServer,
    private readonly callRepo: ICallRepository,
    private readonly deepgramApiKey: string,
    private readonly openAIApiKey: string,
    private readonly ttsModel: string,
    private readonly llmModel: string,
    private readonly logger: FastifyBaseLogger,
  ) {
    audioSocketServer.on('call', (session: AudioSocketSession) => {
      this.handleCall(session).catch((err) => {
        logger.error({ err }, 'Unhandled voice agent session error');
      });
    });
  }

  private async handleCall(audioSession: AudioSocketSession): Promise<void> {
    const callId = uuidv4();
    const startedAt = Date.now();
    this.logger.info({ callId, channelUuid: audioSession.uuid }, 'Voice agent call started');

    await this.callRepo.create({
      id: callId,
      channelId: audioSession.uuid,
      callerId: null,
      startedAt,
    });

    const agent = new DeepgramVoiceAgentClient(
      this.deepgramApiKey,
      this.openAIApiKey,
      this.logger,
      this.ttsModel,
      this.llmModel,
    );

    let outcome: 'answered' | 'transferred' | 'dropped' = 'answered';
    let settled = false;

    const settle = (result: typeof outcome) => {
      if (settled) return;
      settled = true;
      outcome = result;
    };

    // Caller audio → Deepgram
    audioSession.on('audio', (pcm: Buffer) => agent.sendAudio(pcm));

    // Deepgram audio → Caller (split into 320-byte / 20ms frames for Asterisk)
    const FRAME_BYTES = 320;
    agent.on('audio', (pcm: Buffer) => {
      for (let i = 0; i < pcm.length; i += FRAME_BYTES) {
        audioSession.sendAudio(pcm.subarray(i, i + FRAME_BYTES));
      }
    });

    // Log every conversation turn
    agent.on('conversationText', ({ role, content }: { role: string; content: string }) => {
      this.logger.info({ callId, role, preview: content.slice(0, 100) }, 'Conversation turn');
      this.callRepo.addTranscript({
        id: uuidv4(),
        callId,
        role: role === 'user' ? 'user' : 'assistant',
        content,
      }).catch(() => {});
    });

    // Transfer requested via Deepgram function calling
    agent.on('functionCall', ({ name, callId: fcId }: { name: string; callId: string }) => {
      if (name !== 'transfer_to_agent') return;
      this.logger.info({ callId }, 'Transfer to human agent requested');
      settle('transferred');
      // Acknowledge the function so Deepgram plays the transfer phrase
      agent.sendFunctionResult(fcId, 'Connecting you with a team member now. Please hold.');
      // Close after 4 s — gives Deepgram time to finish speaking
      setTimeout(() => { agent.close(); audioSession.hangup(); }, 4_000);
    });

    agent.on('error', () => settle('dropped'));

    agent.connect();

    // Suspend until the session ends (caller hangup or transfer timeout)
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      audioSession.once('hangup', done);
      agent.once('close', done);
    });

    agent.close();

    const durationMs = Date.now() - startedAt;
    await this.callRepo.close(callId, outcome).catch(() => {});
    this.logger.info({ callId, outcome, durationMs }, 'Voice agent call ended');
  }
}
