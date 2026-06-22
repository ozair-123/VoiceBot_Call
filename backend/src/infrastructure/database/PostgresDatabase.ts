import pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';

const { Pool } = pg;

export class PostgresDatabase {
  private pool: pg.Pool;

  constructor(connectionString: string, private readonly logger: FastifyBaseLogger) {
    this.pool = new Pool({ connectionString });
    this.logger.info('PostgreSQL pool created');
  }

  getPool(): pg.Pool {
    return this.pool;
  }

  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS calls (
          id              TEXT        PRIMARY KEY,
          channel_id      TEXT        UNIQUE NOT NULL,
          caller_id       TEXT,
          started_at      BIGINT      NOT NULL,
          ended_at        BIGINT,
          outcome         TEXT        CHECK(outcome IN ('answered','transferred','dropped','no_speech')),
          transfer_reason TEXT
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS transcripts (
          id          TEXT    PRIMARY KEY,
          call_id     TEXT    NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
          role        TEXT    NOT NULL CHECK(role IN ('user','assistant')),
          content     TEXT    NOT NULL,
          confidence  FLOAT,
          duration_ms INTEGER,
          created_at  BIGINT  NOT NULL
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_transcripts_call_id ON transcripts(call_id)
      `);
      this.logger.info('Database migrations applied');
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
