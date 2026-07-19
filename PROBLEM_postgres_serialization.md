# Problem: `postgres@3.4.9` serialization fails on Node.js runtime

## Symptom

On Vercel (Node.js runtime), all SQL template queries using the `postgres` npm package fail with:

```
TypeError [ERR_INVALID_ARG_TYPE]:
  The "string" argument must be of type string or an instance of
  Buffer or ArrayBuffer. Received an instance of [Date|Object]
```

The same code works perfectly on local Bun runtime.

## Root Cause

The `postgres@3.4.9` package internally uses `Buffer.from()` to serialize tagged template parameters before sending them to PostgreSQL. When a non-primitive JavaScript value is passed — `Date`, plain `Object`, or the package's own internal `Parameter` class — `Buffer.from()` throws because it only accepts `string`, `Buffer`, or `ArrayBuffer`.

Three specific failure points were identified:

### 1. Date objects

Parameters like `new Date()` are not auto-serialized to ISO strings by the Node.js pure-JS implementation. Bun's native PostgreSQL driver handles this transparently; Node.js does not.

### 2. `sql.json()` / `transaction.json()` results

The `.json()` method returns an internal `Parameter` instance. On Node.js, `instanceof Parameter` checks fail (likely due to ESM/CJS module boundary), so the parameter is treated as a plain Object and rejected.

### 3. Transaction callback (`sql.begin(callback)`)

When `sql.begin(callback)` is used, the transaction object passed to the callback is the _raw_ TransactionSql, not a wrapped version. Any non-primitive parameter used inside the callback is not serialized.

## Failed Attempts

- `ssl: "require"` — unrelated (was a TLS config issue, not the cause)
- `serverExternalPackages: ["postgres"]` — kept the package external to Next.js bundling, but the serialization bug persisted regardless
- `bunVersion: "1.x"` on Vercel — makes Vercel use Bun for the build step, but the **runtime** remained Node.js and the bug persisted
- `AbortSignal.timeout()` replacement — unrelated (improved compatibility but didn't fix the core issue)
