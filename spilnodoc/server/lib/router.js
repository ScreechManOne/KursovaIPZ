import { HttpError, readJson, sendJson } from './http.js';

/**
 * Мінімальний маршрутизатор: зіставляє метод і шаблон шляху
 * (наприклад, /api/documents/:id) з обробником.
 * Обробник отримує контекст { req, res, params, query, body, user }
 * і повертає об'єкт, який буде надіслано як JSON.
 */
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, ...handlers) {
    const keys = [];
    const regex = new RegExp(
      '^' +
        pattern.replace(/\/:([a-zA-Z]+)/g, (_, key) => {
          keys.push(key);
          return '/([^/]+)';
        }) +
        '/?$',
    );
    this.routes.push({ method, regex, keys, handlers });
  }

  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  patch(p, ...h) { this.add('PATCH', p, ...h); }
  delete(p, ...h) { this.add('DELETE', p, ...h); }

  /** Повертає true, якщо запит оброблено цим маршрутизатором. */
  async handle(req, res, url) {
    let pathMatched = false;
    for (const route of this.routes) {
      const match = route.regex.exec(url.pathname);
      if (!match) continue;
      pathMatched = true;
      if (route.method !== req.method) continue;

      const ctx = {
        req,
        res,
        url,
        query: Object.fromEntries(url.searchParams),
        params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])])),
        body: {},
        user: null,
      };
      try {
        if (req.method === 'POST' || req.method === 'PATCH') ctx.body = await readJson(req);
        let result;
        // Ланцюжок обробників: проміжні (наприклад, перевірка токена) і кінцевий
        for (const handler of route.handlers) {
          result = await handler(ctx);
          if (res.writableEnded || res.headersSent) return true;
        }
        sendJson(res, result?.status || 200, result?.body ?? result);
      } catch (err) {
        handleError(res, err);
      }
      return true;
    }
    if (pathMatched) {
      sendJson(res, 405, { error: 'Метод не підтримується' });
      return true;
    }
    return false;
  }
}

function handleError(res, err) {
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: err.message, details: err.details });
    return;
  }
  console.error(err);
  if (!res.headersSent) sendJson(res, 500, { error: 'Внутрішня помилка сервера' });
}

/** Допоміжна функція для відповіді з кодом, відмінним від 200. */
export const withStatus = (status, body) => ({ status, body });
