import { db } from '../db.js';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { withStatus } from '../lib/router.js';
import { requireAuth } from '../lib/access.js';
import { validate, EMAIL_RE, PASSWORD_RE } from '../lib/validate.js';
import { hashPassword, verifyPassword, createToken, createRateLimiter, pickColor } from '../lib/security.js';

// Не більше 10 спроб входу або реєстрації з однієї IP-адреси за 15 хвилин
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: config.authRateLimit });

function limitByIp(ctx) {
  const ip = ctx.req.socket.remoteAddress || 'unknown';
  const { allowed, retryAfter } = authLimiter(ip);
  if (!allowed) {
    ctx.res.setHeader('Retry-After', retryAfter);
    throw new HttpError(429, `Забагато спроб. Повторіть через ${retryAfter} с`);
  }
}

const insertUser = db.prepare(
  'INSERT INTO users (email, name, password_hash, color) VALUES (?, ?, ?, ?) RETURNING id, email, name, color',
);
const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, color: u.color });

export function registerAuthRoutes(router) {
  router.post('/api/auth/register', limitByIp, async ({ body }) => {
    const data = validate(body, {
      name: { type: 'string', required: true, min: 2, max: 60 },
      email: { type: 'string', required: true, max: 120, pattern: EMAIL_RE, message: 'Некоректна адреса електронної пошти' },
      password: {
        type: 'string', required: true, trim: false, max: 128, pattern: PASSWORD_RE,
        message: 'Пароль має містити щонайменше 8 символів, літеру та цифру',
      },
    });

    if (findByEmail.get(data.email)) {
      throw new HttpError(409, 'Користувач з такою електронною поштою вже існує');
    }
    const hash = await hashPassword(data.password);
    const user = insertUser.get(data.email.toLowerCase(), data.name, hash, pickColor());
    return withStatus(201, { token: createToken(user), user: publicUser(user) });
  });

  router.post('/api/auth/login', limitByIp, async ({ body }) => {
    const data = validate(body, {
      email: { type: 'string', required: true, max: 120 },
      password: { type: 'string', required: true, trim: false, max: 128 },
    });
    const user = findByEmail.get(data.email);
    // Однакове повідомлення для неіснуючого email і неправильного пароля
    if (!user || !(await verifyPassword(data.password, user.password_hash))) {
      throw new HttpError(401, 'Неправильна електронна пошта або пароль');
    }
    return { token: createToken(user), user: publicUser(user) };
  });

  router.get('/api/auth/me', requireAuth, ({ user }) => ({ user: publicUser(user) }));
}
