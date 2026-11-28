import type { Database } from 'sql.js';
import type { Db, SqlParam, SqlStatement } from './types';

function bind(params: SqlParam[] | undefined): (string | number | null)[] {
  return (params ?? []).map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

/**
 * Wraps an in-memory SQLite (sql.js) database in the app's Db interface.
 * Used for automated tests and for previewing the UI in a normal browser.
 */
export function createSqlJsDb(database: Database, onChange?: () => void): Db {
  database.run('PRAGMA foreign_keys=ON;');
  return {
    async execute(sql, params) {
      database.run(sql, bind(params));
      const rowsAffected = database.getRowsModified();
      onChange?.();
      return { rowsAffected };
    },
    async select<T>(sql: string, params?: SqlParam[]) {
      const stmt = database.prepare(sql);
      try {
        stmt.bind(bind(params));
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    },
    async batch(statements: SqlStatement[]) {
      database.run('BEGIN');
      try {
        for (const s of statements) database.run(s.sql, bind(s.params));
        database.run('COMMIT');
      } catch (e) {
        database.run('ROLLBACK');
        throw e;
      }
      onChange?.();
    },
  };
}
