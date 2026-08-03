# MIMIT scheduled import

The production deployment refreshes the MIMIT dataset through
`GET /api/internal/mimit-import`. Vercel Cron invokes only production
deployments and, when `CRON_SECRET` is configured in Vercel, sends it as
`Authorization: Bearer <CRON_SECRET>` automatically. The endpoint also accepts
`POST` for an authenticated manual relaunch; it does not trust the user agent.

`vercel.json` schedules `30 8 * * *`, which is **08:30 UTC** every day. This
is deliberately after the usual morning MIMIT publication: it is 09:30 in
Italy during CET and 10:30 during CEST. Vercel cron expressions are UTC, so
the local Italian wall-clock time moves by one hour at daylight-saving changes.
On the Vercel Hobby plan, daily cron jobs have hourly precision: this expression
can run at any point in the **08:00–08:59 UTC** window (09:00–09:59 CET or
10:00–10:59 CEST), rather than exactly at 08:30.

## Runtime configuration

Set `DATABASE_URL` and a random `CRON_SECRET` of at least 32 characters in the
production Vercel environment. These values are server-only; never use a
`NEXT_PUBLIC_` prefix.
Vercel has no automatic cron retry, so failures must be investigated from the
structured `mimit_import_*` logs and the `fuelradar.import_runs` table.

The endpoint returns only a small public-safe result:

- `200` for a completed import or an unchanged/circuit-open skip;
- `409` with `reason: "already-running"` if another cron or manual run has an
  active import claim;
- `401` for missing or invalid bearer authentication;
- `500` for a failed import, without exposing upstream or database details.

The importer retries only transient MIMIT fetch failures (network errors, 408,
425, 429 and 5xx), at most three total attempts with short exponential delays.
Parsing and database failures are never retried. After three failed imports of
the same metadata version within 24 hours, the circuit breaker records a
skipped run and waits for a new MIMIT version. The last active dataset is never
removed before a fully parsed replacement is inserted and activated.

Prices are checked and downloaded daily. The station registry is downloaded on
the first import and then every 30 days. Between refreshes, the importer copies
the last validated station snapshot inside PostgreSQL and downloads only the
price file. A station refresh is brought forward when unavailable station IDs
become material: at least 100 affected price rows, or at least 10 rows and 1%
of accepted plus unavailable prices. A fresh station/price pair must have the
same extraction date; a reused station snapshot may be older than the prices.

Each invocation first creates a persistent `running` claim in a short database
transaction guarded by a non-blocking advisory lock. Network requests and CSV
parsing then happen outside database transactions. A process terminated by the
platform leaves its claim visible; after the 15-minute lease expires, the next
invocation marks that stale run as failed and safely claims a replacement. The
final dataset insertion, activation, and deletion of every preceding dataset
remain one atomic database transaction. A successful changed import therefore
leaves exactly one dataset. Any insertion, activation, or retention failure
rolls the transaction back and preserves the previous active dataset.

Successful structured logs include non-sensitive retention counts and whether
stations were refreshed. The public HTTP response remains intentionally small.

The one-time production cleanup and physical space recovery procedure is
documented in `docs/mimit-retention.md` and must not be executed without an
explicit maintenance approval.

Production retention is enabled by default after the approved initial cleanup.
`MIMIT_RETENTION_ENABLED=false` is an emergency-only pause: while disabled,
successful imports retain inactive snapshots and database growth resumes.

## Manual relaunch and preview verification

Use an authenticated request, keeping the secret out of shell history and
logs. For example, provide it through a local environment variable:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://fuelradar.michaelpiccirilli.it/api/internal/mimit-import
```

Preview deployments are not invoked by Vercel Cron. To verify one, configure
`DATABASE_URL` and `CRON_SECRET` for that preview environment and issue the
same authenticated request to its preview URL. Do not add redirects in front
of this endpoint because Vercel Cron does not follow them.
