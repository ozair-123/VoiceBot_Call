import net from 'node:net';
import { EventEmitter } from 'node:events';
import type { FastifyBaseLogger } from 'fastify';

export interface AGIVariables {
  channel: string;
  callerid: string;
  calleridname: string;
  extension: string;
  context: string;
  [key: string]: string;
}

export class AGICall extends EventEmitter {
  variables: AGIVariables = {} as AGIVariables;

  private buffer = '';
  private headersParsed = false;
  private pendingResolve: ((result: string) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;

  constructor(private readonly socket: net.Socket, private readonly logger: FastifyBaseLogger) {
    super();

    socket.on('data', (data) => this.onData(data.toString()));
    socket.on('close', () => {
      this.emit('hangup');
      if (this.pendingResolve) {
        this.pendingReject?.(new Error('Channel hung up'));
        this.pendingResolve = null;
        this.pendingReject = null;
      }
    });
    socket.on('error', (err) => {
      this.logger.warn({ err }, 'AGI socket error');
      this.emit('error', err);
      this.pendingReject?.(err);
    });
  }

  private onData(data: string): void {
    this.buffer += data;

    if (!this.headersParsed) {
      const headerEnd = this.buffer.indexOf('\n\n');
      if (headerEnd === -1) return;

      const headerBlock = this.buffer.slice(0, headerEnd);
      this.buffer = this.buffer.slice(headerEnd + 2);

      for (const line of headerBlock.split('\n')) {
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const key = line.slice(4, colon).trim().toLowerCase().replace(/-/g, '_');
        const value = line.slice(colon + 1).trim();
        this.variables[key] = value;
      }

      this.headersParsed = true;
      this.emit('ready');
      return;
    }

    const newline = this.buffer.indexOf('\n');
    if (newline === -1) return;

    const response = this.buffer.slice(0, newline).trim();
    this.buffer = this.buffer.slice(newline + 1);

    this.logger.debug({ response }, 'AGI response');

    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingReject = null;
      resolve(response);
    }
  }

  private sendCommand(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.pendingResolve) {
        reject(new Error('Command already pending'));
        return;
      }
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.logger.debug({ cmd }, 'AGI command');
      this.socket.write(cmd + '\n');
    });
  }

  async answer(): Promise<void> {
    await this.sendCommand('ANSWER');
  }

  async recordFile(filename: string, silenceSeconds = 1): Promise<void> {
    await this.sendCommand(`RECORD FILE ${filename} wav "" -1 s=${silenceSeconds}`);
  }

  // Returns true if played fully, false if interrupted by DTMF or hangup
  async streamFile(filename: string): Promise<boolean> {
    const res = await this.sendCommand(`STREAM FILE ${filename} "0123456789*#"`);
    if (res.includes('-1')) {
      this.emit('hangup');
      return false;
    }
    const match = res.match(/result=(-?\d+)/);
    const digit = match ? parseInt(match[1]!, 10) : 0;
    return digit === 0; // 0 = completed normally, >0 = DTMF digit pressed
  }

  async getVariable(name: string): Promise<string> {
    const res = await this.sendCommand(`GET VARIABLE ${name}`);
    const match = res.match(/result=1\s+\((.+)\)/);
    return match ? match[1]! : '';
  }

  async hangup(): Promise<void> {
    try {
      await this.sendCommand('HANGUP');
    } catch {
      // ignore — channel may already be gone
    }
    this.socket.destroy();
  }

  destroy(): void {
    this.socket.destroy();
  }
}

export class AsteriskFastAGIServer extends EventEmitter {
  private server: net.Server;

  constructor(
    private readonly port: number,
    private readonly logger: FastifyBaseLogger,
  ) {
    super();

    this.server = net.createServer((socket) => {
      const call = new AGICall(socket, logger);

      call.once('ready', () => {
        logger.info(
          { channel: call.variables['channel'], callerid: call.variables['callerid'] },
          'AGI call connected',
        );
        this.emit('call', call);
      });
    });
  }

  listen(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, '0.0.0.0', () => {
        this.logger.info({ port: this.port }, 'FastAGI server listening');
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
