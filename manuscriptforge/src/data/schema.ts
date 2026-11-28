import type { Db } from '../platform/types';

/**
 * Database migrations, applied in order. Never edit a migration that has
 * shipped: add a new one instead, so existing libraries upgrade safely.
 */
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE books (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      book_type TEXT NOT NULL DEFAULT 'fiction',
      genre TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'und',
      status TEXT NOT NULL DEFAULT 'imported',
      word_count INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      never_cloud INTEGER NOT NULL DEFAULT 0,
      source_name TEXT,
      source_format TEXT,
      original_path TEXT,
      author_contact TEXT NOT NULL DEFAULT '',
      received_at TEXT,
      decision TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_opened_at TEXT
    )`,
    `CREATE TABLE chapters (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      hash TEXT NOT NULL,
      plain TEXT NOT NULL,
      search TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX chapters_by_book ON chapters(book_id, position)`,
    `CREATE TABLE versions (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      word_count INTEGER NOT NULL,
      chapter_count INTEGER NOT NULL,
      signature TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX versions_by_book ON versions(book_id, created_at)`,
    `CREATE TABLE version_chapters (
      version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      chapter_id TEXT NOT NULL,
      title TEXT NOT NULL,
      blob_hash TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      PRIMARY KEY (version_id, position)
    )`,
    `CREATE INDEX version_chapters_by_blob ON version_chapters(blob_hash)`,
    // Chapter content is stored once per distinct text, however many versions share it.
    `CREATE TABLE blobs (hash TEXT PRIMARY KEY, content TEXT NOT NULL)`,
    `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      level TEXT NOT NULL,
      scope TEXT NOT NULL,
      message TEXT NOT NULL,
      detail TEXT
    )`,
  ],
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function migrate(db: Db): Promise<void> {
  await db.execute('CREATE TABLE IF NOT EXISTS schema_info (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)');
  const rows = await db.select<{ version: number }>('SELECT version FROM schema_info WHERE id = 1');
  const current = rows[0]?.version ?? 0;
  if (current > MIGRATIONS.length) {
    throw new Error(
      'This library was created by a newer version of ManuscriptForge. Update the app to open it.',
    );
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.batch([
      ...MIGRATIONS[v].map((sql) => ({ sql })),
      { sql: 'INSERT INTO schema_info (id, version) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version', params: [v + 1] },
    ]);
  }
}
