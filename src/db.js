import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS objects (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  singular      TEXT NOT NULL,
  icon          TEXT NOT NULL DEFAULT '📁',
  primary_field TEXT,
  board_field   TEXT,
  value_field   TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fields (
  id               INTEGER PRIMARY KEY,
  object_id        INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,
  label            TEXT NOT NULL,
  type             TEXT NOT NULL,
  options          TEXT NOT NULL DEFAULT '[]',
  target_object_id INTEGER REFERENCES objects(id) ON DELETE CASCADE,
  required         INTEGER NOT NULL DEFAULT 0,
  show_in_list     INTEGER NOT NULL DEFAULT 1,
  position         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (object_id, key)
);

CREATE TABLE IF NOT EXISTS records (
  id         INTEGER PRIMARY KEY,
  object_id  INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  data       TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS records_object ON records (object_id);

CREATE TABLE IF NOT EXISTS activities (
  id         INTEGER PRIMARY KEY,
  record_id  INTEGER REFERENCES records(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  body       TEXT NOT NULL,
  due_at     TEXT,
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activities_record ON activities (record_id);
`;

export function openDb(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/**
 * Runs fn atomically, rolling back if it throws. Uses savepoints so calls
 * can nest (e.g. creating an object also creates its first field).
 */
export function transaction(db, fn) {
  db.exec('SAVEPOINT tx');
  try {
    const result = fn();
    db.exec('RELEASE tx');
    return result;
  } catch (err) {
    db.exec('ROLLBACK TO tx; RELEASE tx');
    throw err;
  }
}
