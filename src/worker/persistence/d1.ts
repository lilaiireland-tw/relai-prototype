/** Structural subset of the D1 binding used by repositories; no runtime adapter. */
export interface PersistenceDatabase {
  prepare(sql: string): PersistenceStatement
}

export type SqlValue = string | number | null

export interface PersistenceStatement {
  bind(...values: SqlValue[]): PersistenceStatement
  first<T>(): Promise<T | null>
  run(): Promise<{ success: boolean; meta: { changes: number } }>
}

export interface MutationResult {
  changes: number
}

export async function insertRow<T>(statement: PersistenceStatement): Promise<T> {
  const row = await statement.first<T>()
  if (row === null) throw new Error('Persistence insert returned no row.')
  return row
}

export async function mutate(statement: PersistenceStatement): Promise<MutationResult> {
  const result = await statement.run()
  if (!result.success) throw new Error('Persistence mutation failed.')
  return { changes: result.meta.changes }
}
