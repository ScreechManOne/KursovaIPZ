// Інтеграційні тести REST API та механізму спільного редагування.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spilnodoc-'));
process.env.DATA_DIR = tmp;
process.env.AUTH_RATE_LIMIT = '1000';
process.env.LOG_REQUESTS = '0';

const { server } = await import('../server/app.js');
let base;

before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

async function api(method, url, { token, body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

/** Відкриває SSE-потік і збирає події в масив. */
async function openStream(docId, token, clientId, since) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/documents/${docId}/stream?clientId=${clientId}&since=${since}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  const events = [];
  const decoder = new TextDecoder();
  let buffer = '';
  (async () => {
    try {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of block.split('\n')) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
        }
      }
    } catch { /* потік закрито */ }
  })();
  return { events, close: () => controller.abort() };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let alice;
let bob;
let docId;

test('реєстрація перевіряє вхідні дані', async () => {
  const bad = await api('POST', '/api/auth/register', { body: { name: 'A', email: 'not-mail', password: '123' } });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.details.email);
  assert.ok(bad.data.details.password);
});

test('реєстрація та вхід користувачів', async () => {
  const a = await api('POST', '/api/auth/register', { body: { name: 'Аліна', email: 'alina@test.ua', password: 'secret123' } });
  assert.equal(a.status, 201);
  alice = a.data.token;
  const dup = await api('POST', '/api/auth/register', { body: { name: 'Аліна', email: 'ALINA@test.ua', password: 'secret123' } });
  assert.equal(dup.status, 409);

  await api('POST', '/api/auth/register', { body: { name: 'Богдан', email: 'bogdan@test.ua', password: 'qwerty789' } });
  const wrong = await api('POST', '/api/auth/login', { body: { email: 'bogdan@test.ua', password: 'wrong999' } });
  assert.equal(wrong.status, 401);
  const ok = await api('POST', '/api/auth/login', { body: { email: 'bogdan@test.ua', password: 'qwerty789' } });
  assert.equal(ok.status, 200);
  bob = ok.data.token;
});

test('захищені маршрути вимагають токен', async () => {
  assert.equal((await api('GET', '/api/documents')).status, 401);
  assert.equal((await api('GET', '/api/documents', { token: 'abc.def.ghi' })).status, 401);
});

test('створення документа і контроль доступу', async () => {
  const created = await api('POST', '/api/documents', { token: alice, body: { title: 'План проєкту' } });
  assert.equal(created.status, 201);
  docId = created.data.document.id;

  assert.equal((await api('GET', `/api/documents/${docId}`, { token: bob })).status, 404);
  const share = await api('POST', `/api/documents/${docId}/members`, { token: alice, body: { email: 'bogdan@test.ua', role: 'viewer' } });
  assert.equal(share.status, 201);

  const asViewer = await api('GET', `/api/documents/${docId}`, { token: bob });
  assert.equal(asViewer.data.document.role, 'viewer');
  const forbidden = await api('POST', `/api/documents/${docId}/operations`, {
    token: bob, body: { clientId: 'bob-client-1', revision: 0, ops: ['x'] },
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await api('DELETE', `/api/documents/${docId}`, { token: bob })).status, 403);

  const bobId = share.data.member.id;
  await api('PATCH', `/api/documents/${docId}/members/${bobId}`, { token: alice, body: { role: 'editor' } });
  const list = await api('GET', '/api/documents', { token: bob });
  assert.equal(list.data.documents[0].role, 'editor');
});

test('паралельні правки двох користувачів сходяться', async () => {
  const sa = await openStream(docId, alice, 'alice-client-1', 0);
  const sb = await openStream(docId, bob, 'bob-client-1', 0);

  await api('POST', `/api/documents/${docId}/operations`, { token: alice, body: { clientId: 'alice-client-1', revision: 0, ops: ['Привіт'] } });

  // Обидва користувачі одночасно змінюють текст ревізії 1
  const [ra, rb] = await Promise.all([
    api('POST', `/api/documents/${docId}/operations`, { token: alice, body: { clientId: 'alice-client-1', revision: 1, ops: [6, ', світе'] } }),
    api('POST', `/api/documents/${docId}/operations`, { token: bob, body: { clientId: 'bob-client-1', revision: 1, ops: ['Ей! ', 6] } }),
  ]);
  assert.equal(ra.status, 202);
  assert.equal(rb.status, 202);
  await wait(100);

  const doc = await api('GET', `/api/documents/${docId}`, { token: bob });
  assert.equal(doc.data.document.revision, 3);
  assert.equal(doc.data.document.content, 'Ей! Привіт, світе');

  const opsA = sa.events.filter((e) => e.type === 'op').map((e) => e.revision);
  const opsB = sb.events.filter((e) => e.type === 'op').map((e) => e.revision);
  assert.deepEqual(opsA, [1, 2, 3]);
  assert.deepEqual(opsB, [1, 2, 3]);
  assert.ok(sa.events.some((e) => e.type === 'presence' && e.users.length === 2));
  sa.close();
  sb.close();
});

test('версії: збереження і відновлення', async () => {
  const saved = await api('POST', `/api/documents/${docId}/versions`, { token: alice, body: { label: 'Перша чернетка' } });
  assert.equal(saved.status, 201);
  await api('POST', `/api/documents/${docId}/operations`, { token: alice, body: { clientId: 'alice-client-1', revision: 3, ops: [-17, 'Новий текст'] } });
  const restored = await api('POST', `/api/documents/${docId}/versions/${saved.data.version.id}/restore`, { token: bob });
  assert.equal(restored.status, 200);
  const doc = await api('GET', `/api/documents/${docId}`, { token: alice });
  assert.equal(doc.data.document.content, 'Ей! Привіт, світе');
});

test('некоректні операції відхиляються', async () => {
  const r1 = await api('POST', `/api/documents/${docId}/operations`, { token: alice, body: { clientId: 'alice-client-1', revision: 99, ops: ['x'] } });
  assert.equal(r1.status, 400);
  const r2 = await api('POST', `/api/documents/${docId}/operations`, { token: alice, body: { clientId: 'alice-client-1', revision: 0, ops: [{ evil: true }] } });
  assert.equal(r2.status, 400);
  const r3 = await api('POST', `/api/documents/${docId}/operations`, { token: alice, body: { clientId: 'alice-client-1', revision: 5, ops: [1000] } });
  assert.equal(r3.status, 409);
});

test('видалення документа власником', async () => {
  assert.equal((await api('DELETE', `/api/documents/${docId}`, { token: alice })).status, 204);
  assert.equal((await api('GET', `/api/documents/${docId}`, { token: alice })).status, 404);
});
