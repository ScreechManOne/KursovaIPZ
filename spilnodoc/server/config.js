import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data');
fs.mkdirSync(dataDir, { recursive: true });

/**
 * Секрет для підпису JWT. Береться зі змінної середовища, а якщо її немає —
 * генерується один раз і зберігається у файлі data/.jwt-secret,
 * щоб токени не ставали недійсними після перезапуску сервера.
 */
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(dataDir, '.jwt-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  dbFile: process.env.DB_FILE || path.join(dataDir, 'spilnodoc.db'),
  jwtSecret: loadSecret(),
  tokenTtlSeconds: 60 * 60 * 12,      // токен дійсний 12 годин
  maxBodyBytes: 1024 * 1024,          // максимальний розмір тіла запиту — 1 МБ
  maxDocumentLength: 200_000,         // максимальна довжина документа в символах
  autoVersionEvery: 100,              // автоматична версія кожні 100 ревізій
  heartbeatMs: 25_000,                // інтервал службових повідомлень у SSE-потоці
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT) || 10, // спроб входу за 15 хвилин
  logRequests: process.env.LOG_REQUESTS !== '0',
};
