// Just enough of bun:test for the checker — the runner brings the real one.
declare module "bun:test" {
  interface Matchers {
    toBe(v: unknown): void
    toEqual(v: unknown): void
    toContain(v: unknown): void
    toHaveLength(n: number): void
    toBeNull(): void
    toBeDefined(): void
    toBeGreaterThan(n: number): void
    toBeCloseTo(n: number): void
    not: Matchers
  }
  export function describe(name: string, fn: () => void): void
  export function test(name: string, fn: () => void | Promise<void>): void
  export function expect(value: unknown): Matchers
}
