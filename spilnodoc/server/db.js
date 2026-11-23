import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

/**
 * Підключення до SQLite через вбудований модуль node:sqlite.
 * Режим WAL дозволяє читати базу під час запису, а foreign_keys
 * вмикає перевірку зовнішніх ключів і каскадне видалення.
 */
export const db = new DatabaseSync(config.dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    color         TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS documents (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL,
    content    TEXT    NOT NULL DEFAULT '',
    revision   INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS document_members (
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT    NOT NULL CHECK (role IN ('editor', 'viewer')),
    added_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (document_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS operations (
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    revision    INTEGER NOT NULL,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    client_id   TEXT    NOT NULL,
    ops         TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (document_id, revision)
  );

  CREATE TABLE IF NOT EXISTS versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    revision    INTEGER NOT NULL,
    label       TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_auto     INTEGER NOT NULL DEFAULT 0 CHECK (is_auto IN (0, 1)),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_members_user ON document_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_versions_doc ON versions(document_id, created_at);
`);

/** Виконує функцію в межах транзакції: або всі зміни зберігаються, або жодна. */
export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
