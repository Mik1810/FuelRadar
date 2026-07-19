# Solution: Proxy-based SQL parameter serializer

## File

`src/server/db/connection.ts`

## Approach

A `Proxy` wraps the `postgres` SQL client and intercepts all tagged template calls (`sql\`...\``). Every parameter is converted to a PostgreSQL-safe primitive **before** it reaches the `postgres` package.

## Implementation

### `toSqlValue(value)` — parameter converter

| Input type | Output |
|---|---|
| `null` / `undefined` | pass-through |
| `string`, `number`, `boolean`, `bigint` | pass-through |
| `Date` | `.toISOString()` |
| `Buffer`, `ArrayBuffer` | pass-through |
| Any other `object` | `JSON.stringify()` |

### Proxy `apply` trap — intercepts `` sql`...` ``

```typescript
apply(target, thisArg, [template, ...params]) {
  return Reflect.apply(target, thisArg, [
    template,
    ...params.map(toSqlValue),
  ]);
}
```

### Proxy `get` trap — intercepts `.begin()` and `.json()`

**`.begin()`** — handles both forms:

- `sql.begin()` → returns `Promise<TransactionSql>` → wraps result with same Proxy
- `sql.begin(callback)` → wraps the transaction passed to the callback with same Proxy

**`.json()`** — returns `JSON.stringify(obj)` directly instead of the internal `Parameter` object, bypassing the `instanceof` check that fails on Node.js.

### Why this works

- **Universal coverage**: every tagged template call in the entire codebase — including inside transactions, nested calls, Drizzle ORM internals — is intercepted
- **Future-proof**: any new query that passes a `Date` or plain `Object` is automatically protected
- **Runtime-agnostic**: works on both Bun and Node.js, local and Vercel
- **Zero overhead on primitives**: strings, numbers, booleans, null pass through instantly
- **No code changes needed**: existing queries work as-is; no manual serialization in any file

## Files changed

| File | Change |
|---|---|
| `src/server/db/connection.ts` | Added Proxy wrapper with `toSqlValue`, `apply` trap, `get` trap |
| `src/server/mimit/source-client.ts` | Replaced `AbortSignal.timeout()` with `AbortController` (cleaner resource cleanup) |
| `scripts/import-mimit.ts` | Added `.trim()` on DATABASE_URL |
| `vercel.json` | Added `bunVersion: "1.x"` (faster builds) |
| `package.json` | Added `bun --bun` to dev/build scripts |
