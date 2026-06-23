import type { ICallRepository } from '../../domain/repositories/ICallRepository.js';
import type { Call, CallOutcome, Transcript } from '../../domain/entities/Call.js';

// Used when DATABASE_URL is not set (local dev / test mode)
export class NoOpCallRepository implements ICallRepository {
  async create(data: { id: string; channelId: string; callerId: string | null; startedAt: number }): Promise<Call> {
    return { id: data.id, channelId: data.channelId, callerId: data.callerId, startedAt: data.startedAt, endedAt: null, outcome: null, transferReason: null };
  }
  async close(): Promise<void> {}
  async addTranscript(data: { id: string; callId: string; role: 'user' | 'assistant'; content: string; confidence?: number; durationMs?: number }): Promise<Transcript> {
    return { id: data.id, callId: data.callId, role: data.role, content: data.content, confidence: data.confidence ?? null, durationMs: data.durationMs ?? null, createdAt: Date.now() };
  }
}
