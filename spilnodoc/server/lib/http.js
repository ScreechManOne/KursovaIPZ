import { config } from '../config.js';

/** Помилка з HTTP-кодом, яку обробник маршрутів перетворює на JSON-відповідь. */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Заголовки безпеки, які додаються до кожної відповіді сервера. */
export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

export function sendJson(res, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...securityHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

/** Зчитує тіло запиту як JSON з обмеженням розміру. */
export function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = req.headers['content-type'] || '';
    const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'];
    if (!hasBody) {
      resolve({});
      return;
    }
    if (!type.startsWith('application/json')) {
      reject(new HttpError(415, 'Очікується тіло запиту у форматі JSON'));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > config.maxBodyBytes) {
        reject(new HttpError(413, 'Тіло запиту завелике'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new HttpError(400, 'Некоректний JSON'));
      }
    });
    req.on('error', reject);
  });
}
