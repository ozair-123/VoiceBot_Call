import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { env } from './config/env.js';
import { PostgresDatabase } from './infrastructure/database/PostgresDatabase.js';
import { CallRepository } from './infrastructure/repositories/CallRepository.js';
import { NoOpCallRepository } from './infrastructure/repositories/NoOpCallRepository.js';
import type { ICallRepository } from './domain/repositories/ICallRepository.js';
import { OpenAIClient } from './infrastructure/external/OpenAIClient.js';
import { OllamaClient } from './infrastructure/external/OllamaClient.js';
import { WhisperClient } from './infrastructure/external/WhisperClient.js';
import { DeepgramClient } from './infrastructure/external/DeepgramClient.js';
import { PiperClient } from './infrastructure/external/PiperClient.js';
import { ElevenLabsClient } from './infrastructure/external/ElevenLabsClient.js';
import { GoogleTTSClient } from './infrastructure/external/GoogleTTSClient.js';
import { AsteriskFastAGIServer } from './infrastructure/external/AsteriskFastAGIServer.js';
import { SSHFileTransferService } from './infrastructure/external/SSHFileTransferService.js';
import { LLMService } from './application/services/LLMService.js';
import { STTService } from './application/services/STTService.js';
import { TTSService } from './application/services/TTSService.js';
import { AudioCacheService } from './application/services/AudioCacheService.js';
import { QueueTransferService } from './application/services/QueueTransferService.js';
import { CallSessionService } from './application/services/CallSessionService.js';
import { AudioSocketServer } from './infrastructure/external/AudioSocketServer.js';
import { VoiceAgentSessionService } from './application/services/VoiceAgentSessionService.js';

export interface Container {
  logger: FastifyBaseLogger;
  audioDir: string;

  db: PostgresDatabase | null;
  callRepo: ICallRepository;

  openaiClient: OpenAIClient;
  ollamaClient: OllamaClient;
  whisperClient: WhisperClient;
  piperClient: PiperClient;
  agiServer: AsteriskFastAGIServer;
  sshTransfer: SSHFileTransferService;
  audioSocketServer: AudioSocketServer;

  llmService: LLMService;
  sttService: STTService;
  ttsService: TTSService;
  audioCache: AudioCacheService;
  transferService: QueueTransferService;
  callSessionService: CallSessionService;
  voiceAgentService: VoiceAgentSessionService | null;
}

export async function buildContainer(): Promise<Container> {
  const pinoOptions =
    env.NODE_ENV === 'development'
      ? { level: env.LOG_LEVEL, transport: { target: 'pino-pretty', options: { colorize: true } } }
      : { level: env.LOG_LEVEL };

  const logger = pino(pinoOptions) as unknown as FastifyBaseLogger;

  let db: PostgresDatabase | null = null;
  let callRepo;

  if (env.DATABASE_URL) {
    db = new PostgresDatabase(env.DATABASE_URL, logger);
    await db.migrate();
    callRepo = new CallRepository(db.getPool());
  } else {
    logger.warn('DATABASE_URL not set — using in-memory repository (calls will not be persisted)');
    callRepo = new NoOpCallRepository();
  }

  const openaiClient = new OpenAIClient(env.OPENAI_API_KEY, env.OPENAI_MODEL, env.OPENAI_TIMEOUT_MS, logger);
  const ollamaClient = new OllamaClient(env.OLLAMA_BASE_URL, env.OLLAMA_MODEL, env.OLLAMA_TIMEOUT_MS, logger);
  const whisperClient = new WhisperClient(env.WHISPER_BASE_URL, env.WHISPER_TIMEOUT_MS, logger);
  const deepgramClient = env.DEEPGRAM_API_KEY
    ? new DeepgramClient(env.DEEPGRAM_API_KEY, env.DEEPGRAM_MODEL, env.DEEPGRAM_TIMEOUT_MS, logger)
    : null;

  const sttClient = deepgramClient ?? whisperClient;
  logger.info({ provider: deepgramClient ? 'deepgram' : 'whisper' }, 'STT provider selected');
  const piperClient = new PiperClient(env.PIPER_EXE_PATH, env.PIPER_MODEL_PATH, env.AUDIO_DIR, env.PIPER_TIMEOUT_MS, logger);
  const agiServer = new AsteriskFastAGIServer(env.FASTAGI_PORT, logger);
  const sshTransfer = new SSHFileTransferService(env.AST_SSH_HOST, env.AST_SSH_USER, env.AST_SSH_KEY_PATH, logger);

  const googleTTS = env.GOOGLE_TTS_API_KEY
    ? new GoogleTTSClient(env.GOOGLE_TTS_API_KEY, env.AUDIO_DIR, logger)
    : null;

  const englishTTS = googleTTS
    ?? (env.ELEVENLABS_API_KEY
      ? new ElevenLabsClient(env.ELEVENLABS_API_KEY, env.ELEVENLABS_VOICE_ID, env.ELEVENLABS_MODEL_ID, env.AUDIO_DIR, logger)
      : piperClient);

  const urduTTS = googleTTS ?? piperClient;

  logger.info({
    english: googleTTS ? 'google' : (env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'piper'),
    urdu: googleTTS ? 'google' : 'piper',
  }, 'TTS backends selected');

  const llmService = new LLMService(openaiClient, logger);
  const sttService = new STTService(sttClient, env.AUDIO_DIR, logger);
  const ttsService = new TTSService(englishTTS, urduTTS, env.AUDIO_DIR, logger);

  const audioCache = new AudioCacheService(ttsService, sshTransfer, env.AUDIO_DIR, env.AST_TMP_DIR, logger);
  const transferService = new QueueTransferService(sshTransfer, ttsService, env.AST_TMP_DIR, logger);

  const callSessionService = new CallSessionService(
    agiServer,
    sshTransfer,
    callRepo,
    sttService,
    ttsService,
    llmService,
    transferService,
    audioCache,
    env.AST_TMP_DIR,
    env.LOCAL_TMP_DIR,
    logger,
  );

  // Deepgram Voice Agent path (real-time audio, no SFTP)
  const audioSocketServer = new AudioSocketServer(logger);
  const voiceAgentService = env.DEEPGRAM_API_KEY
    ? new VoiceAgentSessionService(
        audioSocketServer,
        callRepo,
        env.DEEPGRAM_API_KEY,
        env.OPENAI_API_KEY,
        env.DEEPGRAM_TTS_MODEL,
        env.OPENAI_MODEL,
        logger,
      )
    : null;

  if (!voiceAgentService) {
    logger.warn('DEEPGRAM_API_KEY not set — Voice Agent (AudioSocket) disabled, FastAGI only');
  }

  return {
    logger, audioDir: env.AUDIO_DIR,
    db, callRepo,
    openaiClient, ollamaClient, whisperClient, piperClient, agiServer, sshTransfer, audioSocketServer,
    llmService, sttService, ttsService, audioCache, transferService, callSessionService, voiceAgentService,
  };
}
