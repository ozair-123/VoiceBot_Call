import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import fs from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import type { Container } from '../../container.js';

export const testRoutes: FastifyPluginAsync<{ container: Container }> = async (app, { container }) => {
  // POST /api/test/voice — upload a WAV, run full STT → LLM → TTS pipeline
  app.post('/voice', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No audio file uploaded' });

    const filename = `test-${uuidv4()}.wav`;
    const filePath = path.join(container.audioDir, filename);
    fs.mkdirSync(container.audioDir, { recursive: true });

    await pipeline(data.file, fs.createWriteStream(filePath));

    // STT
    let transcript = '';
    let sttDurationMs = 0;
    try {
      const sttResult = await container.sttService.transcribeFile(filePath);
      transcript = sttResult.text;
      sttDurationMs = sttResult.durationMs;
    } finally {
      container.sttService.deleteFile(filePath);
    }

    if (!transcript.trim()) {
      return reply.send({ transcript: '', response: null, audioUrl: null, sttDurationMs });
    }

    // LLM
    let response = '';
    let llmDurationMs = 0;
    const llmStart = Date.now();
    try {
      response = await container.llmService.sendMessage([], transcript);
      llmDurationMs = Date.now() - llmStart;
    } catch (err) {
      app.log.error({ err }, 'LLM error during test');
      return reply.status(500).send({ error: 'LLM failed', transcript });
    }

    // TTS
    let audioUrl = null;
    let ttsDurationMs = 0;
    try {
      const ttsResult = await container.ttsService.synthesize(response);
      const audioFilename = container.ttsService.getRelativeFilename(ttsResult.audioPath);
      audioUrl = `/api/audio/files/${audioFilename}`;
      ttsDurationMs = ttsResult.durationMs;
    } catch (err) {
      app.log.warn({ err }, 'TTS failed during test');
    }

    return reply.send({
      transcript,
      response,
      audioUrl,
      timings: { sttMs: sttDurationMs, llmMs: llmDurationMs, ttsMs: ttsDurationMs },
    });
  });

  // POST /api/test/text — send text directly, get LLM + TTS response
  app.post('/text', async (req, reply) => {
    const { text } = req.body as { text?: string };
    if (!text?.trim()) return reply.status(400).send({ error: 'text field required' });

    const llmStart = Date.now();
    let response = '';
    try {
      response = await container.llmService.sendMessage([], text);
    } catch (err) {
      app.log.error({ err }, 'LLM error during test');
      return reply.status(500).send({ error: 'LLM failed' });
    }
    const llmDurationMs = Date.now() - llmStart;

    let audioUrl = null;
    let ttsDurationMs = 0;
    try {
      const ttsResult = await container.ttsService.synthesize(response);
      audioUrl = `/api/audio/files/${container.ttsService.getRelativeFilename(ttsResult.audioPath)}`;
      ttsDurationMs = ttsResult.durationMs;
    } catch (err) {
      app.log.warn({ err }, 'TTS failed during test');
    }

    return reply.send({ input: text, response, audioUrl, timings: { llmMs: llmDurationMs, ttsMs: ttsDurationMs } });
  });
};
