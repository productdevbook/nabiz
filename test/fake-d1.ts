import type { Db } from "../src/lib/db.ts"

/** Just enough D1 for the state machine to run against: canned rows out,
 *  bound writes captured for the test to read. */
export interface Bound {
  sql: string
  args: unknown[]
}

export function fakeDb(rowsBySql: (sql: string) => unknown[]) {
  const writes: Bound[] = []
  const statement = (sql: string) => ({
    bind: (...args: unknown[]) => {
      const bound = { sql, args }
      return {
        ...bound,
        all: async () => ({ results: rowsBySql(sql) }),
        first: async () => rowsBySql(sql)[0] ?? null,
        run: async () => {
          writes.push(bound)
          return {}
        },
      }
    },
    all: async () => ({ results: rowsBySql(sql) }),
    first: async () => rowsBySql(sql)[0] ?? null,
    run: async () => {
      writes.push({ sql, args: [] })
      return {}
    },
  })
  const db = {
    prepare: statement,
    batch: async (stmts: Bound[]) => {
      writes.push(...stmts)
      return stmts.map(() => ({ results: [] }))
    },
  }
  return { db: db as unknown as Db, writes }
}
