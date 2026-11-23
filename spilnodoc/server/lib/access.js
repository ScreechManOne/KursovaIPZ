import { db } from '../db.js';
import { HttpError } from './http.js';
import { verifyToken } from './security.js';

const findUser = db.prepare('SELECT id, email, name, color FROM users WHERE id = ?');

/**
 * Проміжний обробник: перевіряє заголовок Authorization: Bearer <token>
 * і записує поточного користувача в ctx.user.
 */
export function requireAuth(ctx) {
  const header = ctx.req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) throw new HttpError(401, 'Потрібна автентифікація');

  const user = findUser.get(payload.sub);
  if (!user) throw new HttpError(401, 'Користувача не знайдено');
  ctx.user = user;
}

const findAccess = db.prepare(`
  SELECT d.id, d.title, d.owner_id, d.revision, d.updated_at,
         CASE WHEN d.owner_id = :userId THEN 'owner' ELSE m.role END AS role
  FROM documents d
  LEFT JOIN document_members m ON m.document_id = d.id AND m.user_id = :userId
  WHERE d.id = :docId
`);

/** Рівні доступу впорядковано від найменшого до найбільшого. */
const LEVEL = { viewer: 1, editor: 2, owner: 3 };

/**
 * Визначає роль користувача щодо документа і перевіряє, що вона не нижча
 * за потрібну. Якщо доступу немає зовсім, повертається 404, щоб не
 * розкривати сам факт існування документа.
 */
export function documentAccess(docId, userId, minRole = 'viewer') {
  const row = findAccess.get({ docId, userId });
  if (!row || !row.role) throw new HttpError(404, 'Документ не знайдено');
  if (LEVEL[row.role] < LEVEL[minRole]) throw new HttpError(403, 'Недостатньо прав для цієї дії');
  return row;
}
