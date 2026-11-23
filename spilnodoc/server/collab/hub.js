import { db, transaction } from '../db.js';
import { config } from '../config.js';
import { HttpError, securityHeaders } from '../lib/http.js';
import { TextOperation, transformIndex } from '../../shared/ot.js';

/**
 * Центр спільного редагування.
 * Для кожного відкритого документа зберігає перелік підключених клієнтів
 * (SSE-потоків) і відповідає за прийом, перетворення та розсилку операцій.
 *
 * Сервер є єдиним джерелом істини: він присвоює кожній прийнятій операції
 * наступний номер ревізії, тому всі клієнти бачать операції в однаковому порядку.
 */

/** @type {Map<number, Map<string, {res, user, cursor:number}>>} */
const rooms = new Map();

const getDoc = db.prepare('SELECT content, revision FROM documents WHERE id = ?');
const getOpsSince = db.prepare(
  'SELECT revision, user_id, client_id, ops FROM operations WHERE document_id = ? AND revision > ? ORDER BY revision',
);
const insertOp = db.prepare(
  'INSERT INTO operations (document_id, revision, user_id, client_id, ops) VALUES (?, ?, ?, ?, ?)',
);
const updateDoc = db.prepare(
  "UPDATE documents SET content = ?, revision = ?, updated_at = datetime('now') WHERE id = ?",
);
const insertVersion = db.prepare(
  'INSERT INTO versions (document_id, revision, label, content, created_by, is_auto) VALUES (?, ?, ?, ?, ?, ?)',
);

function send(client, event) {
  client.res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function broadcast(docId, event) {
  const room = rooms.get(docId);
  if (!room) return;
  for (const client of room.values()) send(client, event);
}

function presenceOf(docId) {
  const room = rooms.get(docId);
  if (!room) return [];
  return [...room.entries()].map(([clientId, c]) => ({
    clientId,
    userId: c.user.id,
    name: c.user.name,
    color: c.user.color,
    cursor: c.cursor,
  }));
}

const broadcastPresence = (docId) => broadcast(docId, { type: 'presence', users: presenceOf(docId) });

/**
 * Приймає операцію клієнта, створену над ревізією `revision`.
 * Якщо за цей час сервер уже прийняв інші операції, нова операція
 * послідовно перетворюється відносно кожної з них (функція transform),
 * після чого застосовується до актуального тексту.
 */
export function submitOperation({ docId, user, clientId, revision, ops }) {
  let operation;
  try {
    operation = TextOperation.fromJSON(ops);
  } catch (err) {
    throw new HttpError(400, err.message);
  }

  const result = transaction(() => {
    const doc = getDoc.get(docId);
    if (revision > doc.revision) throw new HttpError(400, 'Ревізія клієнта новіша за серверну');

    for (const row of getOpsSince.all(docId, revision)) {
      const concurrent = TextOperation.fromJSON(JSON.parse(row.ops));
      [operation] = TextOperation.transform(operation, concurrent);
    }

    if (operation.baseLength !== doc.content.length) {
      throw new HttpError(409, 'Операція не відповідає поточному стану документа');
    }
    const content = operation.apply(doc.content);
    if (content.length > config.maxDocumentLength) {
      throw new HttpError(413, `Документ не може перевищувати ${config.maxDocumentLength} символів`);
    }

    const newRevision = doc.revision + 1;
    insertOp.run(docId, newRevision, user?.id ?? null, clientId, JSON.stringify(operation.ops));
    updateDoc.run(content, newRevision, docId);

    if (newRevision % config.autoVersionEvery === 0) {
      insertVersion.run(docId, newRevision, `Автозбереження (ревізія ${newRevision})`, content, null, 1);
    }
    return { revision: newRevision };
  });

  // Курсори інших учасників зсуваються з урахуванням нової операції
  const room = rooms.get(docId);
  if (room) {
    for (const [id, c] of room) {
      if (id !== clientId) c.cursor = transformIndex(c.cursor, operation);
    }
  }

  broadcast(docId, {
    type: 'op',
    revision: result.revision,
    clientId,
    userId: user?.id ?? null,
    ops: operation.ops,
  });
  return result;
}

/**
 * Відкриває SSE-потік для документа. Спочатку надсилаються всі операції
 * після ревізії `since` (на випадок, якщо клієнт щось пропустив під час
 * перепідключення), далі — події в реальному часі.
 */
export function subscribe({ docId, user, clientId, since, req, res }) {
  const doc = getDoc.get(docId);
  if (!Number.isInteger(since) || since < 0 || since > doc.revision) {
    throw new HttpError(400, 'Некоректний параметр since');
  }

  res.writeHead(200, {
    ...securityHeaders,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  if (!rooms.has(docId)) rooms.set(docId, new Map());
  const room = rooms.get(docId);
  const previous = room.get(clientId);
  if (previous) previous.res.end();

  const client = { res, user, cursor: 0 };
  for (const row of getOpsSince.all(docId, since)) {
    send(client, { type: 'op', revision: row.revision, clientId: row.client_id, userId: row.user_id, ops: JSON.parse(row.ops) });
  }
  room.set(clientId, client);
  broadcastPresence(docId);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), config.heartbeatMs);

  req.on('close', () => {
    clearInterval(heartbeat);
    if (room.get(clientId) === client) {
      room.delete(clientId);
      if (room.size === 0) rooms.delete(docId);
      broadcastPresence(docId);
    }
  });
}

export function updateCursor(docId, clientId, userId, position) {
  const client = rooms.get(docId)?.get(clientId);
  if (!client || client.user.id !== userId) throw new HttpError(404, 'Сеанс редагування не знайдено');
  client.cursor = position;
  broadcast(docId, { type: 'cursor', clientId, cursor: position });
}

/** Сповіщення про зміну назви документа. */
export const notifyTitle = (docId, title) => broadcast(docId, { type: 'title', title });

/** Закриває потоки користувача, якого позбавили доступу, або всі потоки видаленого документа. */
export function disconnect(docId, userId = null, reason = 'revoked') {
  const room = rooms.get(docId);
  if (!room) return;
  for (const [id, c] of room) {
    if (userId === null || c.user.id === userId) {
      send(c, { type: 'closed', reason });
      c.res.end();
      room.delete(id);
    }
  }
  if (room.size === 0) rooms.delete(docId);
  else broadcastPresence(docId);
}

/** Кількість активних учасників документа (для списку документів). */
export const onlineCount = (docId) => rooms.get(docId)?.size ?? 0;
