# Solution: isolate raw SQL and Drizzle postgres.js clients

## File

`src/server/db/connection.ts`

## Approach

FuelRadar now creates two lazy postgres.js clients from the same trimmed runtime
URL and conservative pool settings:

- `sqlClient` is reserved for raw tagged-template queries;
- a private client is passed to Drizzle and exposed only through `db`.

Drizzle can therefore install the serializers it needs without mutating the raw
client used by the importer and nearby search. postgres.js retains its native
Date, JSON, query-fragment, identifier, builder, array, and typed-parameter
semantics; no Proxy or generic object conversion is involved.

Both clients have `max: 1` and connect lazily. A request that only uses the raw
client does not open a Drizzle connection. The returned `close()` method closes
both pools so scripts and development shutdown do not leak resources.

## Why this is safer

- fixes the serializer ownership conflict at its boundary;
- preserves the public postgres.js tagged-template contract;
- keeps `sql.json()` typed as JSONB;
- requires no special transaction or savepoint wrappers;
- avoids silently converting query fragments or identifiers to JSON strings.

Focused contract tests verify client isolation, the native Date/JSON serializers,
query composition, identifiers, and typed JSON parameters. Production endpoint
verification remains the final check because the original failure appeared only
in the deployed Node.js runtime.

## Related changes

The earlier timeout cleanup, URL trimming, and Bun build configuration are
separate operational changes; they are not the cause of this database fix.
