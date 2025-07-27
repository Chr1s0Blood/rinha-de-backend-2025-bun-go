import { Database } from "bun:sqlite";
import path from "path";
import { connect, type NatsConnection } from "@nats-io/transport-node";

let db: Database;
let natsConnection: NatsConnection | null = null;

let queriesSentToOptimize = 0;

async function getNatsConnection() {
  if (!natsConnection) {
    natsConnection = await connect({
      servers: process.env.NATS_URL!,
    });
  }
  return natsConnection;
}

async function sendSqlToNats(sql: string, params: any[]) {
  const nc = await getNatsConnection();
  const message = JSON.stringify({ sql, params });
  nc.publish("sqlite-requests", new TextEncoder().encode(message));
}

export function connectToSQLite() {
  if (!db) {
    const dbPath =
      process.env.DATABASE_URL || path.join(process.cwd(), "rinha.db");
    db = new Database(dbPath, { create: true });

    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }
}

export async function createPaymentsTable() {
  try {
    connectToSQLite();

    db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        correlation_id TEXT PRIMARY KEY,
        amount DECIMAL NOT NULL,
        requested_at TEXT NOT NULL,
        processed_at TEXT,
        processor TEXT NOT NULL DEFAULT 'default'
      );
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_payments_processed_at_processor ON payments(processed_at, processor);
      CREATE INDEX IF NOT EXISTS idx_payments_processor_processed_at ON payments(processor, processed_at);
      CREATE INDEX IF NOT EXISTS idx_payments_processed_at ON payments(processed_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_correlation_id ON payments(correlation_id);
    `);
  } catch (error) {
    console.error("Erro ao configurar tabela payments:", error);
    throw error;
  }
}

export async function insertPaymentData(
  correlationId: string,
  amount: number,
  requestedAt: string,
  processor: string = "default"
) {
  const sql = `INSERT OR IGNORE INTO payments (correlation_id, amount, requested_at, processor) VALUES (?, ?, ?, ?)`;
  const params = [
    correlationId,
    parseFloat(amount.toString()),
    requestedAt,
    processor,
  ];

  await sendSqlToNats(sql, params);

  queriesSentToOptimize++;

  if (queriesSentToOptimize >= 300) {
    queriesSentToOptimize = 0;
    const optimizeSql = `PRAGMA optimize`;
    await sendSqlToNats(optimizeSql, []);
  }
}

export async function getSummary(from: string, to: string) {
  connectToSQLite();

  const stmt = db.prepare(`
    SELECT 
      processor,
      COUNT(*) as total_requests,
      COALESCE(SUM(amount), 0) as total_amount
    FROM payments
    WHERE processed_at >= ? AND processed_at <= ?
    GROUP BY processor
  `);

  return stmt.all(from, to);
}

export async function purgePayments() {
  const sql = `DELETE FROM payments`;
  const params: any[] = [];

  await sendSqlToNats(sql, params);
}

export async function updateProcessorColumn(
  correlationId: string,
  newProcessor: string
) {
  const sql = `UPDATE payments SET processor = ? WHERE correlation_id = ?`;
  const params = [newProcessor, correlationId];

  await sendSqlToNats(sql, params);
}

export async function updateProcessedAt(
  correlationId: string,
  processedAt: string
) {
  const sql = `UPDATE payments SET processed_at = ? WHERE correlation_id = ?`;
  const params = [processedAt, correlationId];

  await sendSqlToNats(sql, params);
}

export async function updateProcessedAtAndProcessor(
  correlationId: string,
  processedAt: string,
  processor: string
) {
  const sql = `UPDATE payments SET processed_at = ?, processor = ? WHERE correlation_id = ?`;
  const params = [processedAt, processor, correlationId];

  await sendSqlToNats(sql, params);
}
