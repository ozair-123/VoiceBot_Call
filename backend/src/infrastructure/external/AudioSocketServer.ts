import net from 'node:net';
import { EventEmitter } from 'node:events';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Represents one active phone call over the Asterisk AudioSocket protocol.
 * Audio format: slin16 — signed 16-bit little-endian PCM at 8 kHz (no RTP headers).
 */
export class AudioSocketSession extends EventEmitter {
  private closed = false;

  constructor(
    public readonly uuid: string,
    private readonly socket: net.Socket,
    private readonly logger: FastifyBaseLogger,
  ) {
    super();
    socket.on('close', () => { if (!this.closed) this.emit('hangup'); });
    socket.on('error', (err) => {
      if (!this.closed) this.logger.warn({ err, uuid }, 'AudioSocket connection error');
      if (!this.closed) this.emit('hangup');
    });
  }

  sendAudio(pcm: Buffer): void {
    if (this.closed || this.socket.destroyed) return;
    const header = Buffer.allocUnsafe(3);
    header[0] = 0x10;
    header.writeUInt16BE(pcm.length, 1);
    try { this.socket.write(Buffer.concat([header, pcm])); } catch {}
  }

  hangup(): void {
    if (this.closed) return;
    this.closed = true;
    const header = Buffer.allocUnsafe(3);
    header[0] = 0x01;
    header.writeUInt16BE(0, 1);
    try { this.socket.write(header); } catch {}
    this.socket.destroy();
    this.emit('hangup');
  }
}

/**
 * TCP server that accepts Asterisk AudioSocket connections.
 * Emits 'call' with an AudioSocketSession for each inbound call.
 *
 * Asterisk dialplan:
 *   same => n,AudioSocket(VOICEBOT_IP:9093,${UNIQUEID})
 *   same => n,Queue(support)   ; called after bot session ends (transfer path)
 */
export class AudioSocketServer extends EventEmitter {
  private server: net.Server;

  constructor(private readonly logger: FastifyBaseLogger) {
    super();
    this.server = net.createServer((socket) => this.handleConnection(socket));
    this.server.on('error', (err) => logger.error({ err }, 'AudioSocket server error'));
  }

  private handleConnection(socket: net.Socket): void {
    this.logger.info({ remote: `${socket.remoteAddress}:${socket.remotePort}` }, 'AudioSocket TCP connection received');
    let buffer = Buffer.alloc(0);
    let session: AudioSocketSession | null = null;

    let firstChunk = true;
    socket.on('data', (chunk: Buffer) => {
      if (firstChunk) {
        firstChunk = false;
        this.logger.info({
          bytes: chunk.length,
          firstByte: `0x${chunk[0]!.toString(16).padStart(2, '0')}`,
          secondThirdBytes: `${chunk[1]!.toString(16).padStart(2, '0')}${chunk[2]!.toString(16).padStart(2, '0')}`,
        }, 'AudioSocket FIRST chunk');
      }
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 3) {
        const kind = buffer[0]!;
        const length = buffer.readUInt16BE(1);
        if (buffer.length < 3 + length) break;

        const payload = buffer.subarray(3, 3 + length);
        buffer = buffer.subarray(3 + length);

        switch (kind) {
          case 0x00: {
            // UUID message — first packet on every new call
            const uuid = [
              payload.subarray(0, 4).toString('hex'),
              payload.subarray(4, 6).toString('hex'),
              payload.subarray(6, 8).toString('hex'),
              payload.subarray(8, 10).toString('hex'),
              payload.subarray(10, 16).toString('hex'),
            ].join('-');
            session = new AudioSocketSession(uuid, socket, this.logger);
            this.logger.info({ uuid }, 'AudioSocket call connected');
            this.emit('call', session);
            break;
          }
          case 0x10: // Audio payload
            if (!session) this.logger.warn('Audio packet received before UUID — no session yet');
            session?.emit('audio', payload);
            break;
          case 0x01: // Hangup
            session?.emit('hangup');
            session = null;
            break;
          default:
            this.logger.warn({ kind: `0x${kind.toString(16).padStart(2, '0')}`, length }, 'Unknown AudioSocket packet kind');
        }
      }
    });

    socket.on('error', (err) => this.logger.warn({ err }, 'AudioSocket socket error'));
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(port, '0.0.0.0', () => {
        this.logger.info({ port }, 'AudioSocket server listening');
        resolve();
      });
      this.server.once('error', reject);
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
