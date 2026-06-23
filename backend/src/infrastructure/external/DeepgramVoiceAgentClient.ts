import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import type { FastifyBaseLogger } from 'fastify';
import { SYSTEM_PROMPT, GREETING_EN } from '../../config/constants.js';

/**
 * Deepgram Voice Agent WebSocket client.
 *
 * Audio in/out: signed 16-bit linear PCM at 8 kHz, no container (raw bytes).
 * This matches exactly what Asterisk AudioSocket sends/receives (slin16).
 *
 * Events emitted:
 *   audio(Buffer)                  — PCM audio to send to the caller
 *   userStartedSpeaking()          — barge-in signal
 *   agentStartedSpeaking()
 *   agentAudioDone()               — bot finished its turn
 *   conversationText({role, content}) — transcript + bot response text
 *   functionCall({name, callId})   — transfer_to_agent function triggered
 *   close()
 */
export class DeepgramVoiceAgentClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private ready = false;
  private audioBuffer: Buffer[] = [];

  constructor(
    private readonly apiKey: string,
    private readonly openAIApiKey: string,
    private readonly logger: FastifyBaseLogger,
    private readonly ttsModel = 'aura-asteria-en',
    private readonly llmModel = 'gpt-4o-mini',
  ) {
    super();
  }

  connect(): void {
    this.ws = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', {
      headers: { Authorization: `Token ${this.apiKey}` },
    });

    this.ws.on('open', () => this.onOpen());
    this.ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => this.onMessage(data, isBinary));
    this.ws.on('close', () => { this.ready = false; this.emit('close'); });
    this.ws.on('error', (err) => {
      this.logger.error({ err }, 'Deepgram Voice Agent WebSocket error');
      this.emit('close');
    });
  }

  private onOpen(): void {
    const settings = {
      type: 'SettingsConfiguration',
      audio: {
        input:  { encoding: 'linear16', sample_rate: 8000 },
        output: { encoding: 'linear16', sample_rate: 8000, container: 'none' },
      },
      agent: {
        listen: { model: 'nova-3' },
        think: {
          provider: {
            type: 'open_ai',
            api_key: this.openAIApiKey,
          },
          model: this.llmModel,
          instructions: SYSTEM_PROMPT,
          functions: [{
            name: 'transfer_to_agent',
            description: 'Transfer the caller to a human agent. Use this when the caller asks for a human, seems frustrated, or when you cannot confidently answer their question.',
            parameters: { type: 'object', properties: {} },
          }],
        },
        speak: { model: this.ttsModel },
      },
      // Inject greeting as prior assistant message so the agent doesn't re-greet
      context: {
        messages: [{ role: 'assistant', content: GREETING_EN }],
        replay: true,
      },
    };

    this.ws!.send(JSON.stringify(settings));
    this.ready = true;

    // Flush audio buffered before connection opened
    for (const chunk of this.audioBuffer) this.ws!.send(chunk);
    this.audioBuffer = [];
  }

  private onMessage(data: WebSocket.RawData, isBinary: boolean): void {
    if (isBinary) {
      this.emit('audio', data as Buffer);
      return;
    }

    let msg: { type: string; [k: string]: unknown };
    try { msg = JSON.parse(data.toString()); } catch { return; }

    this.logger.debug({ type: msg.type }, 'Deepgram VA event');

    switch (msg.type) {
      case 'UserStartedSpeaking':
        this.emit('userStartedSpeaking');
        break;
      case 'AgentStartedSpeaking':
        this.emit('agentStartedSpeaking');
        break;
      case 'AgentAudioDone':
        this.emit('agentAudioDone');
        break;
      case 'ConversationText':
        this.emit('conversationText', {
          role: msg['role'] as string,
          content: msg['content'] as string,
        });
        break;
      case 'FunctionCallRequest':
        this.emit('functionCall', {
          name: msg['function_name'] as string,
          callId: msg['function_call_id'] as string,
        });
        break;
      case 'Welcome':
      case 'SettingsApplied':
        this.logger.info({ type: msg.type }, 'Deepgram VA ready');
        break;
      case 'Error':
        this.logger.error({ msg }, 'Deepgram VA error event');
        break;
    }
  }

  sendAudio(pcm: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.ready) { this.audioBuffer.push(pcm); return; }
    this.ws.send(pcm);
  }

  sendFunctionResult(callId: string, output: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'FunctionCallResponse',
      function_call_id: callId,
      output,
    }));
  }

  close(): void {
    this.ready = false;
    this.audioBuffer = [];
    try { this.ws?.close(); } catch {}
    this.ws = null;
  }
}
