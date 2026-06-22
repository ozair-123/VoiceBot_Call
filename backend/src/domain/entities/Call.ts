export type CallOutcome = 'answered' | 'transferred' | 'dropped' | 'no_speech';

export interface Call {
  id: string;
  channelId: string;
  callerId: string | null;
  startedAt: number;
  endedAt: number | null;
  outcome: CallOutcome | null;
  transferReason: string | null;
}

export interface Transcript {
  id: string;
  callId: string;
  role: 'user' | 'assistant';
  content: string;
  confidence: number | null;
  durationMs: number | null;
  createdAt: number;
}
