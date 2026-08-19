/** The database, as narrowly as nabiz actually uses it. D1 satisfies this
 *  shape as it is; SQLite is made to (see sqlite.ts). Everything else in
 *  lib/ speaks this and knows nothing about where it runs. */
export interface Db {
  prepare(sql: string): Stmt
  batch<T = unknown>(statements: Stmt[]): Promise<{ results: T[] }[]>
}

export interface Stmt {
  bind(...values: unknown[]): Stmt
  all<T = unknown>(): Promise<{ results: T[] }>
  first<T = unknown>(): Promise<T | null>
  run(): Promise<{ meta?: { changes?: number } }>
}
