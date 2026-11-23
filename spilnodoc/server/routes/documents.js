import { db, transaction } from '../db.js';
import { HttpError } from '../lib/http.js';
import { withStatus } from '../lib/router.js';
import { requireAuth, documentAccess } from '../lib/access.js';
import { validate, idParam, EMAIL_RE } from '../lib/validate.js';
import { notifyTitle, disconnect, onlineCount } from '../collab/hub.js';

const listDocs = db.prepare(`
  SELECT d.id, d.title, d.revision, d.updated_at, d.created_at,
         u.name AS owner_name,
         CASE WHEN d.owner_id = :userId THEN 'owner' ELSE m.role END AS role,
         length(d.content) AS length
  FROM documents d
  JOIN users u ON u.id = d.owner_id
  LEFT JOIN document_members m ON m.document_id = d.id AND m.user_id = :userId
  WHERE d.owner_id = :userId OR m.user_id IS NOT NULL
  ORDER BY d.updated_at DESC, d.id DESC
`);
const insertDoc = db.prepare(
  'INSERT INTO documents (owner_id, title, content) VALUES (?, ?, ?) RETURNING id, title, revision, created_at, updated_at',
);
const getFullDoc = db.prepare(`
  SELECT d.id, d.title, d.content, d.revision, d.created_at, d.updated_at,
         u.id AS owner_id, u.name AS owner_name
  FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = ?
`);
const renameDoc = db.prepare("UPDATE documents SET title = ?, updated_at = datetime('now') WHERE id = ?");
const deleteDoc = db.prepare('DELETE FROM documents WHERE id = ?');

const listMembers = db.prepare(`
  SELECT u.id, u.name, u.email, u.color, m.role, m.added_at
  FROM document_members m JOIN users u ON u.id = m.user_id
  WHERE m.document_id = ? ORDER BY u.name
`);
const findUserByEmail = db.prepare('SELECT id, name, email, color FROM users WHERE email = ?');
const upsertMember = db.prepare(`
  INSERT INTO document_members (document_id, user_id, role) VALUES (?, ?, ?)
  ON CONFLICT (document_id, user_id) DO UPDATE SET role = excluded.role
`);
const updateMember = db.prepare('UPDATE document_members SET role = ? WHERE document_id = ? AND user_id = ?');
const removeMember = db.prepare('DELETE FROM document_members WHERE document_id = ? AND user_id = ?');

const TITLE_RULE = { type: 'string', required: true, min: 1, max: 120 };
const ROLE_RULE = { type: 'string', required: true, oneOf: ['editor', 'viewer'] };

export function registerDocumentRoutes(router) {
  /* ----- Документи ----- */

  router.get('/api/documents', requireAuth, ({ user }) => {
    const docs = listDocs.all({ userId: user.id });
    return { documents: docs.map((d) => ({ ...d, online: onlineCount(d.id) })) };
  });

  router.post('/api/documents', requireAuth, ({ body, user }) => {
    const data = validate(body, { title: TITLE_RULE });
    const doc = insertDoc.get(user.id, data.title, '');
    return withStatus(201, { document: { ...doc, role: 'owner', owner_name: user.name } });
  });

  router.get('/api/documents/:id', requireAuth, ({ params, user }) => {
    const id = idParam(params.id);
    const { role } = documentAccess(id, user.id);
    return { document: { ...getFullDoc.get(id), role } };
  });

  router.patch('/api/documents/:id', requireAuth, ({ params, body, user }) => {
    const id = idParam(params.id);
    documentAccess(id, user.id, 'editor');
    const data = validate(body, { title: TITLE_RULE });
    renameDoc.run(data.title, id);
    notifyTitle(id, data.title);
    return { document: { id, title: data.title } };
  });

  router.delete('/api/documents/:id', requireAuth, ({ params, user }) => {
    const id = idParam(params.id);
    documentAccess(id, user.id, 'owner');
    disconnect(id, null, 'deleted');
    deleteDoc.run(id); // операції, учасники та версії видаляються каскадно
    return withStatus(204);
  });

  /* ----- Учасники документа ----- */

  router.get('/api/documents/:id/members', requireAuth, ({ params, user }) => {
    const id = idParam(params.id);
    documentAccess(id, user.id);
    const doc = getFullDoc.get(id);
    return { owner: { id: doc.owner_id, name: doc.owner_name }, members: listMembers.all(id) };
  });

  router.post('/api/documents/:id/members', requireAuth, ({ params, body, user }) => {
    const id = idParam(params.id);
    documentAccess(id, user.id, 'owner');
    const data = validate(body, {
      email: { type: 'string', required: true, max: 120, pattern: EMAIL_RE, message: 'Некоректна адреса електронної пошти' },
      role: ROLE_RULE,
    });
    const invited = findUserByEmail.get(data.email);
    if (!invited) throw new HttpError(404, 'Користувача з такою поштою не зареєстровано');
    if (invited.id === user.id) throw new HttpError(400, 'Власник уже має повний доступ до документа');

    upsertMember.run(id, invited.id, data.role);
    return withStatus(201, { member: { ...invited, role: data.role } });
  });

  router.patch('/api/documents/:id/members/:userId', requireAuth, ({ params, body, user }) => {
    const id = idParam(params.id);
    const memberId = idParam(params.userId);
    documentAccess(id, user.id, 'owner');
    const data = validate(body, { role: ROLE_RULE });
    const { changes } = updateMember.run(data.role, id, memberId);
    if (changes === 0) throw new HttpError(404, 'Учасника не знайдено');
    // Після зміни ролі учасник має перепідключитися, щоб отримати нові права
    disconnect(id, memberId, 'role-changed');
    return { member: { id: memberId, role: data.role } };
  });

  router.delete('/api/documents/:id/members/:userId', requireAuth, ({ params, user }) => {
    const id = idParam(params.id);
    const memberId = idParam(params.userId);
    // Власник може видалити будь-кого, а учасник — лише себе (вийти з документа)
    documentAccess(id, user.id, memberId === user.id ? 'viewer' : 'owner');
    const { changes } = transaction(() => removeMember.run(id, memberId));
    if (changes === 0) throw new HttpError(404, 'Учасника не знайдено');
    disconnect(id, memberId, 'revoked');
    return withStatus(204);
  });
}
