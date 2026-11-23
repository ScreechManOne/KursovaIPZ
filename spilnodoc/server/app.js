import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { Router } from './lib/router.js';
import { sendJson, securityHeaders } from './lib/http.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerCollabRoutes } from './routes/collab.js';

const router = new Router();
registerAuthRoutes(router);
registerDocumentRoutes(router);
registerCollabRoutes(router);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Віддає статичні файли зібраного клієнта з каталогу public.
 * Шлях нормалізується, щоб запит на кшталт /../server/config.js
 * не міг вийти за межі каталогу (захист від path traversal).
 * Для невідомих шляхів повертається index.html — маршрутизацію виконує клієнт.
 */
function serveStatic(req, res, url) {
  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\]*\.\.)+/, '');
  let file = path.resolve(path.join(config.publicDir, safePath));
  if (file !== config.publicDir && !file.startsWith(config.publicDir + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(config.publicDir, 'index.html');
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    ...securityHeaders,
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(file).pipe(res);
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const started = Date.now();
  res.on('finish', () => {
    if (config.logRequests && url.pathname.startsWith('/api/')) {
      console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started} мс`);
    }
  });

  if (url.pathname.startsWith('/api/')) {
    const handled = await router.handle(req, res, url);
    if (!handled) sendJson(res, 404, { error: 'Маршрут не знайдено' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Метод не підтримується' });
    return;
  }
  serveStatic(req, res, url);
});

// SSE-з'єднання тривалі, тому стандартний тайм-аут запиту вимикаємо
server.requestTimeout = 0;
