import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';

export interface SynthesizeResult {
  audioPath: string;
  durationMs: number;
}

export class PiperClient {
  constructor(
    private readonly exePath: string,
    private readonly modelPath: string,
    private readonly audioDir: string,
    private readonly timeoutMs: number,
    private readonly logger: FastifyBaseLogger,
  ) {}

  synthesize(text: string, outputFilename: string): Promise<SynthesizeResult> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const outputPath = path.join(this.audioDir, outputFilename);

      fs.mkdirSync(this.audioDir, { recursive: true });

      const piperExe = this.exePath.replace(/\//g, path.sep);
      const modelFile = this.modelPath.replace(/\//g, path.sep);

      this.logger.debug({ text: text.slice(0, 80), outputPath }, 'Invoking Piper TTS');

      const proc = spawn(piperExe, ['--model', modelFile, '--output_file', outputPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        reject(new Error(`Piper spawn error: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Piper exited with code ${code ?? 'null'}. stderr: ${stderr}`));
          return;
        }
        const durationMs = Date.now() - start;
        this.logger.debug({ outputPath, durationMs }, 'Piper TTS complete');
        resolve({ audioPath: outputPath, durationMs });
      });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`Piper timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      proc.on('close', () => clearTimeout(timer));

      proc.stdin.write(text, 'utf8');
      proc.stdin.end();
    });
  }

  async checkHealth(): Promise<boolean> {
    return fs.existsSync(this.exePath) && fs.existsSync(this.modelPath);
  }
}
