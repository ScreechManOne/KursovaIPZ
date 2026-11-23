import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';

const scrypt = promisify(crypto.scrypt);

/* ---------- Хешування паролів (scrypt) ---------- */

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

/** Повертає рядок формату scrypt$<сіль>$<хеш>, придатний для збереження в БД. */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT_PARAMS);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, SCRYPT_PARAMS);
  // Порівняння за сталий час захищає від атак за часом відгуку
  return crypto.timingSafeEqual(expected, actual);
}

/* ---------- JSON Web Token (HS256) ---------- */

const b64url = (input) => Buffer.from(input).toString('base64url');

function sign(data) {
  return crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url');
}

export function createToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: user.id, name: user.name, iat: now, exp: now + config.tokenTtlSeconds }));
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

/** Перевіряє підпис і строк дії токена. Повертає payload або null. */
export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;

  const expected = Buffer.from(sign(`${header}.${payload}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  try {
    const head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (head.alg !== 'HS256') return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

/* ---------- Обмеження частоти запитів ---------- */

/**
 * Простий лічильник у пам'яті з фіксованим вікном часу.
 * Використовується для захисту входу та реєстрації від підбору пароля.
 */
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs).unref();

  return function check(key) {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    return { allowed: entry.count <= max, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  };
}

/** Колір для позначення користувача серед співавторів. */
const PALETTE = ['#e4572e', '#17bebb', '#76b041', '#ffc914', '#7b5ea7', '#2e86ab', '#d81159', '#f18f01'];
export const pickColor = () => PALETTE[crypto.randomInt(PALETTE.length)];
