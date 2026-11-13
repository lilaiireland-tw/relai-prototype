import type { DatabaseSync } from 'node:sqlite'
import type { PersistenceDatabase, PersistenceStatement, SqlValue } from '../src/worker/persistence/d1'

/** Offline operator/test adapter. batch mirrors D1's all-or-nothing transaction. */
export function sqliteD1(sqlite: DatabaseSync): PersistenceDatabase {
  type Statement = PersistenceStatement & { execute(): number }
  function prepare(sql: string, values: SqlValue[] = []): Statement {
    return {
      bind: (...bound) => {
        if (bound.length > 100) throw new Error('D1 parameter budget exceeded.')
        return prepare(sql, bound)
      },
      async first<T>() { return sqlite.prepare(sql).get(...values) as T ?? null },
      async all<T>() { return { success: true, results: sqlite.prepare(sql).all(...values) as T[] } },
      async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } } },
      execute: () => Number(sqlite.prepare(sql).run(...values).changes),
    }
  }
  return { prepare, async batch(statements) {
    sqlite.exec('BEGIN')
    try {
      const results = statements.map(statement => ({ success: true, meta: { changes: (statement as Statement).execute() } }))
      sqlite.exec('COMMIT')
      return results
    } catch (error) { sqlite.exec('ROLLBACK'); throw error }
  } }
}
