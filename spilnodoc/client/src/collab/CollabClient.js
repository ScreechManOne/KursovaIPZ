import { TextOperation, diffToOperation } from '../../../shared/ot.js';
import { api, tokenStore } from '../api.js';

/**
 * Клієнт спільного редагування одного документа.
 *
 * Стан синхронізації описується двома полями:
 *   pending — операція, надіслана на сервер, але ще не підтверджена;
 *   buffer  — локальні зміни, зроблені після надсилання pending
 *             (накопичуються через compose і надсилаються після підтвердження).
 * Отже, у кожен момент на сервері «в дорозі» не більше однієї операції клієнта,
 * а всі чужі операції перетворюються відносно pending і buffer.
 */
export class CollabClient {
  constructor({ docId, content, revision, handlers }) {
    this.docId = docId;
    this.content = content;
    this.revision = revision;
    this.handlers = handlers;
    this.clientId = crypto.randomUUID().replace(/-/g, '');
    this.pending = null;
    this.buffer = null;
    this.closed = false;
    this.retryDelay = 1000;
    this.abort = null;
  }

  /* ---------- Локальні зміни ---------- */

  /** Викликається редактором після кожної зміни тексту користувачем. */
  applyLocal(newText) {
    const op = diffToOperation(this.content, newText);
    if (op.isNoop()) return;
    this.content = newText;

    if (this.pending) {
      this.buffer = this.buffer ? TextOperation.compose(this.buffer, op) : op;
    } else {
      this.pending = op;
      this.sendPending();
    }
    this.emitStatus();
  }

  async sendPending() {
    try {
      await api.sendOperation(this.docId, {
        clientId: this.clientId,
        revision: this.revision,
        ops: this.pending.toJSON(),
      });
    } catch (err) {
      // Сервер відхилив операцію — стан клієнта розійшовся із серверним.
      // Безпечний вихід — повторно завантажити документ.
      this.handlers.onError?.(err.message);
      await this.resync();
    }
  }

  /* ---------- Події від сервера ---------- */

  handleEvent(event) {
    switch (event.type) {
      case 'op':
        if (event.revision <= this.revision) return; // повтор уже обробленої події
        if (event.clientId === this.clientId) this.handleAck(event);
        else this.handleRemote(event);
        break;
      case 'presence':
        this.handlers.onPresence?.(event.users.filter((u) => u.clientId !== this.clientId));
        break;
      case 'cursor':
        if (event.clientId !== this.clientId) this.handlers.onCursor?.(event.clientId, event.cursor);
        break;
      case 'title':
        this.handlers.onTitle?.(event.title);
        break;
      case 'closed':
        this.handlers.onClosed?.(event.reason);
        this.close();
        break;
      default:
        break;
    }
  }

  /** Сервер підтвердив нашу операцію. */
  handleAck(event) {
    this.revision = event.revision;
    this.pending = this.buffer;
    this.buffer = null;
    if (this.pending) this.sendPending();
    this.emitStatus();
  }

  /** Надійшла операція іншого користувача. */
  handleRemote(event) {
    let op = TextOperation.fromJSON(event.ops);
    if (this.pending) [this.pending, op] = TextOperation.transform(this.pending, op);
    if (this.buffer) [this.buffer, op] = TextOperation.transform(this.buffer, op);
    this.content = op.apply(this.content);
    this.revision = event.revision;
    this.handlers.onRemoteChange?.(this.content, op, event.userId);
    this.emitStatus();
  }

  /* ---------- Потік подій (SSE поверх fetch) ---------- */

  /**
   * Відкриває потік подій. Використовується fetch, а не EventSource,
   * бо EventSource не дозволяє передати заголовок Authorization.
   */
  async connect() {
    while (!this.closed) {
      this.abort = new AbortController();
      try {
        const res = await fetch(
          `/api/documents/${this.docId}/stream?clientId=${this.clientId}&since=${this.revision}`,
          { headers: { Authorization: `Bearer ${tokenStore.get()}` }, signal: this.abort.signal },
        );
        if (res.status === 401 || res.status === 404) {
          this.handlers.onClosed?.('revoked');
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        this.retryDelay = 1000;
        this.handlers.onConnection?.(true);
        await this.readStream(res.body);
      } catch {
        if (this.closed) return;
      }
      this.handlers.onConnection?.(false);
      // Експоненційна затримка перед повторним підключенням (до 15 с)
      await new Promise((r) => setTimeout(r, this.retryDelay));
      this.retryDelay = Math.min(this.retryDelay * 2, 15000);
    }
  }

  async readStream(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ')) this.handleEvent(JSON.parse(line.slice(6)));
        }
      }
    }
  }

  /** Повне перезавантаження стану з сервера (після помилки синхронізації). */
  async resync() {
    const { document } = await api.getDocument(this.docId);
    this.pending = null;
    this.buffer = null;
    this.content = document.content;
    this.revision = document.revision;
    this.handlers.onReset?.(document.content);
    this.abort?.abort(); // потік перепідключиться з новою ревізією
    this.emitStatus();
  }

  sendCursor(position) {
    api.sendCursor(this.docId, { clientId: this.clientId, position }).catch(() => {});
  }

  emitStatus() {
    this.handlers.onStatus?.({
      synced: !this.pending && !this.buffer,
      revision: this.revision,
    });
  }

  close() {
    this.closed = true;
    this.abort?.abort();
  }
}
