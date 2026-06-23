import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  AUDIO_DIR: z.string().default('./data/audio'),
  LOCAL_TMP_DIR: z.string().default('/tmp'),

  // PostgreSQL (optional — omit for local test mode, calls won't be persisted)
  DATABASE_URL: z.string().url().optional(),

  // OpenAI
  OPENAI_API_KEY: z.string(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_TIMEOUT_MS: z.coerce.number().default(15_000),

  // Ollama (kept for local dev fallback)
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('qwen2.5:3b'),
  OLLAMA_TIMEOUT_MS: z.coerce.number().default(120_000),

  // STT — Deepgram (preferred) or Whisper fallback
  DEEPGRAM_API_KEY: z.string().optional(),
  DEEPGRAM_MODEL: z.string().default('nova-3'),
  DEEPGRAM_TIMEOUT_MS: z.coerce.number().default(10_000),

  // STT (faster-whisper python server — fallback when no Deepgram key)
  WHISPER_BASE_URL: z.string().url().default('http://localhost:8001'),
  WHISPER_TIMEOUT_MS: z.coerce.number().default(60_000),

  // TTS (piper — used when ELEVENLABS_API_KEY is not set)
  PIPER_EXE_PATH: z.string().default('/opt/piper/piper'),
  PIPER_MODEL_PATH: z.string().default('/opt/piper/models/en_US-lessac-high.onnx'),
  PIPER_TIMEOUT_MS: z.coerce.number().default(30_000),

  // TTS (ElevenLabs — English)
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default('EXAVITQu4vr4xnSDxMaL'), // Sarah
  ELEVENLABS_MODEL_ID: z.string().default('eleven_turbo_v2_5'),

  // TTS (Google Cloud — English + Urdu, replaces ElevenLabs + Azure)
  GOOGLE_TTS_API_KEY: z.string().optional(),

  // FastAGI server (legacy — kept for fallback)
  FASTAGI_PORT: z.coerce.number().default(4573),

  // AudioSocket server (Deepgram Voice Agent path)
  AUDIOSOCKET_PORT: z.coerce.number().default(9093),
  DEEPGRAM_TTS_MODEL: z.string().default('aura-asteria-en'),

  // Asterisk SSH (for audio file transfer)
  AST_SSH_HOST: z.string().default('62.238.12.90'),
  AST_SSH_USER: z.string().default('root'),
  AST_SSH_KEY_PATH: z.string().default('/var/www/sip-dialer/backend/.ssh/id_rsa'),
  AST_TMP_DIR: z.string().default('/tmp'),

  // Queue transfer
  QUEUE_TRANSFER_CONTEXT: z.string().default('from-queue'),
  QUEUE_TRANSFER_EXTENSION: z.string().default('queue'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:\n', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
