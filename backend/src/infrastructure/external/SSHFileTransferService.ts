import fs from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import { Client } from 'ssh2';
import type { SFTPWrapper } from 'ssh2';

export class SSHFileTransferService {
  private conn: Client | null = null;
  private sftp: SFTPWrapper | null = null;
  private connecting = false;
  private readonly privateKey: Buffer;

  constructor(
    private readonly host: string,
    private readonly username: string,
    privateKeyPath: string,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.privateKey = fs.readFileSync(privateKeyPath);
  }

  private async getSftp(): Promise<SFTPWrapper> {
    if (this.sftp && this.conn) return this.sftp;

    while (this.connecting) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (this.sftp && this.conn) return this.sftp;

    this.connecting = true;
    try {
      const conn = new Client();
      const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
        conn.on('ready', () => {
          conn.sftp((err, s) => {
            if (err) { conn.end(); return reject(err); }
            resolve(s);
          });
        });
        conn.on('error', reject);
        conn.on('close', () => {
          this.conn = null;
          this.sftp = null;
          this.logger.debug('SSH connection closed');
        });
        conn.connect({ host: this.host, port: 22, username: this.username, privateKey: this.privateKey });
      });

      this.conn = conn;
      this.sftp = sftp;
      this.logger.debug({ host: this.host }, 'SSH connection established');
      return sftp;
    } finally {
      this.connecting = false;
    }
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    const sftp = await this.getSftp();
    await new Promise<void>((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, (err) => {
        if (err) return reject(new Error(`SFTP download failed: ${err.message}`));
        this.logger.debug({ remotePath, localPath }, 'SFTP download complete');
        resolve();
      });
    });
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    const sftp = await this.getSftp();
    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (err) => {
        if (err) return reject(new Error(`SFTP upload failed: ${err.message}`));
        this.logger.debug({ localPath, remotePath }, 'SFTP upload complete');
        resolve();
      });
    });
  }

  async deleteRemote(remotePath: string): Promise<void> {
    try {
      const sftp = await this.getSftp();
      await new Promise<void>((resolve) => {
        sftp.unlink(remotePath, () => resolve());
      });
    } catch {
      this.logger.warn({ remotePath }, 'Remote file delete failed');
    }
  }
}
