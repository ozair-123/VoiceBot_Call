import type pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import type { ICallRepository } from '../../domain/repositories/ICallRepository.js';
import type { Call, CallOutcome, Transcript } from '../../domain/entities/Call.js';

export class CallRepository implements ICallRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(data: { id: string; channelId: string; callerId: string | null; startedAt: number }): Promise<Call> {
    const { rows } = await this.pool.query<Call>(
      `INSERT INTO calls (id, channel_id, caller_id, started_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, channel_id AS "channelId", caller_id AS "callerId",
                 started_at AS "startedAt", ended_at AS "endedAt",
                 outcome, transfer_reason AS "transferReason"`,
      [data.id, data.channelId, data.callerId, data.startedAt],
    );
    return rows[0]!;
  }

  async close(id: string, outcome: CallOutcome, transferReason?: string): Promise<void> {
    await this.pool.query(
      `UPDATE calls SET ended_at=$1, outcome=$2, transfer_reason=$3 WHERE id=$4`,
      [Date.now(), outcome, transferReason ?? null, id],
    );
  }

  async addTranscript(data: {
    id: string;
    callId: string;
    role: 'user' | 'assistant';
    content: string;
    confidence?: number;
    durationMs?: number;
  }): Promise<Transcript> {
    const { rows } = await this.pool.query<Transcript>(
      `INSERT INTO transcripts (id, call_id, role, content, confidence, duration_ms, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, call_id AS "callId", role, content, confidence,
                 duration_ms AS "durationMs", created_at AS "createdAt"`,
      [data.id, data.callId, data.role, data.content, data.confidence ?? null, data.durationMs ?? null, Date.now()],
    );
    return rows[0]!;
  }
}
