import type { Call, CallOutcome, Transcript } from '../entities/Call.js';

export interface ICallRepository {
  create(data: { id: string; channelId: string; callerId: string | null; startedAt: number }): Promise<Call>;
  close(id: string, outcome: CallOutcome, transferReason?: string): Promise<void>;
  addTranscript(data: {
    id: string;
    callId: string;
    role: 'user' | 'assistant';
    content: string;
    confidence?: number;
    durationMs?: number;
  }): Promise<Transcript>;
}
