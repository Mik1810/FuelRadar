# Problem: Drizzle changes serializers on the shared postgres.js client

## Symptom

On the Vercel Node.js runtime, raw tagged-template queries failed with:

```
TypeError [ERR_INVALID_ARG_TYPE]:
  The "string" argument must be of type string or an instance of
  Buffer or ArrayBuffer. Received an instance of [Date|Object]
```

The same deployment configuration and database URL worked locally under Bun.

## Root cause

FuelRadar created one `postgres@3.4.9` client and passed that same object both to
Drizzle and to the raw SQL importer. During construction, the Drizzle
`postgres-js` adapter replaces the client's date and JSON serializers with
identity functions. This is correct for values already encoded by Drizzle, but
it also changes later raw tagged-template queries on the shared client.

Consequently, raw `Date` values and values produced by `sql.json()` could reach
the Node.js buffer-writing path without the normal postgres.js conversion to an
ISO or JSON string. The runtime then rejected the non-primitive value.

The original diagnosis that postgres.js itself did not support Date or JSON
serialization was incorrect: its default serializers handle both. No evidence
confirmed an ESM/CJS `instanceof Parameter` failure.

## Approaches that did not address the cause

- changing TLS options;
- externalizing or bundling `postgres` in Next.js;
- selecting Bun for the Vercel build step (the function runtime remained Node);
- changing request timeout management.

These changes did not isolate the serializer mutation on the shared client.
