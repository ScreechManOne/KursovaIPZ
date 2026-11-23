import { db } from '../db.js';
import { HttpError } from '../lib/http.js';
import { withStatus } from '../lib/router.js';
import { requireAuth, documentAccess } from '../lib/access.js';
import { validate, idParam } from '../lib/validate.js';
import { submitOperation, subscribe, updateCursor } from '../collab/hub.js';
import { TextOperation } from '../../shared/ot.js';

const CLIENT_ID_RULE = { type: 'string', required: true, pattern: /^[a-zA-Z0-9_-]{8,64}$/, message: 'Некоректний ідентифікатор клієнта' };

const listVersions = db.prepare(`
  SELECT v.id, v.revision, v.label, v.is_auto, v.created_at, length(v.content) AS length, u.name AS author
  FROM versions v LEFT JOIN users u ON u.id = v.created_by
  WHERE v.document_id = ? ORDER BY v.created_at DESC, v.id DESC LIMIT 100
`);
const getVersion = db.prepare('SELECT * FROM versions WHERE id = ? AND document_id = ?');
const getContent = db.prepare('SELECT content, revision FROM documents WHERE id = ?');
const insertVersion = db.prepare(`
  INSERT INTO versions (document_id, revision, label, content, created_by, is_auto)
  VALUES (?, ?, ?, ?, ?, 0) RETURNING id, revision, label, created_at
`);

export function registerCollabRoutes(router) {
  /** Потік подій документа (Server-Sent Events). */
  router.get('/api/documents/:id/stream', requireAuth, (ctx) => {
    const docId = idParam(ctx.params.id);
    documentAccess(docId, ctx.user.id);
    const { clientId } = validate(ctx.query, { clientId: CLIENT_ID_RULE });
    subscribe({
      docId,
      user: ctx.user,
      clientId,
      since: Number(ctx.query.since),
      req: ctx.req,
      res: ctx.res,
    });
  });

  /** Прийом операції редагування від клієнта. */
  router.post('/api/documents/:id/operations', requireAuth, ({ params, body, user }) => {
    const docId = idParam(params.id);
    documentAccess(docId, user.id, 'editor');
    const data = validate(body, {
      clientId: CLIENT_ID_RULE,
      revision: { type: 'integer', required: true, min: 0 },
      ops: { type: 'array', required: true },
    });
    const result = submitOperation({ docId, user, ...data });
    return withStatus(202, result);
  });

  /** Оновлення позиції курсора поточного клієнта. */
  router.post('/api/documents/:id/cursor', requireAuth, ({ params, body, user }) => {
    const docId = idParam(params.id);
    documentAccess(docId, user.id);
    const data = validate(body, {
      clientId: CLIENT_ID_RULE,
      position: { type: 'integer', required: true, min: 0 },
    });
    updateCursor(docId, data.clientId, user.id, data.position);
    return withStatus(204);
  });

  /* ----- Історія версій ----- */

  router.get('/api/documents/:id/versions', requireAuth, ({ params, user }) => {
    const docId = idParam(params.id);
    documentAccess(docId, user.id);
    return { versions: listVersions.all(docId) };
  });

  router.post('/api/documents/:id/versions', requireAuth, ({ params, body, user }) => {
    const docId = idParam(params.id);
    documentAccess(docId, user.id, 'editor');
    const data = validate(body, { label: { type: 'string', required: true, min: 1, max: 80 } });
    const doc = getContent.get(docId);
    const version = insertVersion.get(docId, doc.revision, data.label, doc.content, user.id);
    return withStatus(201, { version: { ...version, author: user.name, is_auto: 0 } });
  });

  router.get('/api/documents/:id/versions/:versionId', requireAuth, ({ params, user }) => {
    const docId = idParam(params.id);
    documentAccess(docId, user.id);
    const version = getVersion.get(idParam(params.versionId), docId);
    if (!version) throw new HttpError(404, 'Версію не знайдено');
    return { version };
  });

  /**
   * Відновлення версії. Замість прямого перезапису тексту сервер формує
   * звичайну операцію «видалити все — вставити текст версії» і пропускає її
   * через той самий конвеєр, що й правки користувачів. Завдяки цьому
   * всі підключені клієнти отримують зміну без перезавантаження сторінки.
   */
  router.post('/api/documents/:id/versions/:versionId/restore', requireAuth, ({ params, user }) => {
    const docId = idParam(params.id);
    documentAccess(docId, user.id, 'editor');
    const version = getVersion.get(idParam(params.versionId), docId);
    if (!version) throw new HttpError(404, 'Версію не знайдено');

    const doc = getContent.get(docId);
    const op = new TextOperation().delete(doc.content.length).insert(version.content);
    const result = submitOperation({
      docId,
      user,
      clientId: `restore-${version.id}-${Date.now()}`,
      revision: doc.revision,
      ops: op.toJSON(),
    });
    return { revision: result.revision };
  });
}
