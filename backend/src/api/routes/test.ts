import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import fs from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import type { Container } from '../../container.js';

export const testRoutes: FastifyPluginAsync<{ container: Container }> = async (app, { container }) => {
  // POST /api/test/voice — upload audio (WAV/WebM/any), run full STT → LLM → TTS pipeline
  app.post('/voice', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No audio file uploaded' });

    const mimeType = data.mimetype || 'audio/webm;codecs=opus';
    const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('ogg') ? 'ogg' : 'wav';
    const filename = `test-${uuidv4()}.${ext}`;
    const filePath = path.join(container.audioDir, filename);
    fs.mkdirSync(container.audioDir, { recursive: true });

    await pipeline(data.file, fs.createWriteStream(filePath));

    // STT
    let transcript = '';
    let sttDurationMs = 0;
    try {
      const sttResult = await container.sttService.transcribeFile(filePath, mimeType);
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
    const { text, language = 'en' } = req.body as { text?: string; language?: string };
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
      const ttsResult = await container.ttsService.synthesize(response, language);
      audioUrl = `/api/audio/files/${container.ttsService.getRelativeFilename(ttsResult.audioPath)}`;
      ttsDurationMs = ttsResult.durationMs;
    } catch (err) {
      app.log.warn({ err }, 'TTS failed during test');
    }

    return reply.send({ input: text, response, audioUrl, timings: { llmMs: llmDurationMs, ttsMs: ttsDurationMs } });
  });

  // POST /api/test/stream?language=en — streaming voice: STT → LLM tokens → sentence TTS → SSE audio events
  app.post('/stream', async (req, reply) => {
    const sttLanguage = (req.query as Record<string, string>)['language'] || undefined;
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No audio file uploaded' });

    const mimeType = data.mimetype || 'audio/webm;codecs=opus';
    const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('ogg') ? 'ogg' : 'wav';
    const filename = `test-${uuidv4()}.${ext}`;
    const filePath = path.join(container.audioDir, filename);
    fs.mkdirSync(container.audioDir, { recursive: true });
    await pipeline(data.file, fs.createWriteStream(filePath));

    // SSE setup
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    const send = (event: string, payload: object) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    // STT
    let transcript = '';
    try {
      const sttResult = await container.sttService.transcribeFile(filePath, mimeType, sttLanguage);
      transcript = sttResult.text;
      container.sttService.deleteFile(filePath);
    } catch (err) {
      send('error', { message: 'STT failed' });
      reply.raw.end();
      return reply;
    }

    if (!transcript.trim()) {
      send('error', { message: 'No speech detected' });
      reply.raw.end();
      return reply;
    }
    send('transcript', { text: transcript });

    // Stream LLM tokens — buffer into sentences, generate TTS per sentence
    let sentenceBuffer = '';
    let audioIndex = 0;
    let fullResponse = '';

    const flushSentence = async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      fullResponse += (fullResponse ? ' ' : '') + trimmed;
      send('response_chunk', { text: trimmed });
      try {
        const ttsResult = await container.ttsService.synthesize(trimmed);
        const audioUrl = `/api/audio/files/${container.ttsService.getRelativeFilename(ttsResult.audioPath)}`;
        send('audio', { url: audioUrl, index: audioIndex++ });
      } catch { /* TTS error — skip this sentence */ }
    };

    try {
      for await (const token of container.llmService.streamMessage([], transcript)) {
        sentenceBuffer += token;
        // Flush on sentence-ending punctuation followed by space or end
        const match = sentenceBuffer.match(/^(.*?[.!?])\s+([\s\S]*)$/);
        if (match) {
          await flushSentence(match[1]!);
          sentenceBuffer = match[2]!;
        }
      }
      // Flush any remaining text
      if (sentenceBuffer.trim()) await flushSentence(sentenceBuffer);
    } catch (err) {
      send('error', { message: 'LLM failed' });
    }

    send('done', { fullResponse });
    reply.raw.end();
    return reply;
  });

  // POST /api/test/tts — test TTS directly without LLM
  app.post('/tts', async (req, reply) => {
    const { text, language = 'en' } = req.body as { text?: string; language?: string };
    if (!text?.trim()) return reply.status(400).send({ error: 'text field required' });

    try {
      const ttsResult = await container.ttsService.synthesize(text, language);
      const audioUrl = `/api/audio/files/${container.ttsService.getRelativeFilename(ttsResult.audioPath)}`;
      return reply.send({ text, language, audioUrl, ttsMs: ttsResult.durationMs });
    } catch (err) {
      app.log.error({ err }, 'TTS error during test');
      return reply.status(500).send({ error: String(err) });
    }
  });
};
