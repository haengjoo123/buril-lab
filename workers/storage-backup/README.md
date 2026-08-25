# Cabinet image storage backup Worker

This is an OFF-first scheduled Worker. It has no `fetch` handler and cannot be
invoked through a public HTTP route. A run reaches Supabase or R2 only when the
existing `runtime_config` KV object contains the JSON boolean
`"storage_backup_enabled": true`. Missing bindings, KV failures, malformed
objects, and the string `"true"` all stay OFF.

Every Supabase request uses redirect mode `error`, so service credentials are
never forwarded through an HTTP redirect. A failed backup throws only its
allow-listed result code from the scheduled entrypoint so Cloudflare records a
failed Cron invocation; disabled, locked, and completed runs resolve normally.
An active lock older than half its bounded TTL resolves with the separate safe
code `backup_locked_extended` for alerting; malformed or abusive future locks
fail the invocation.

## Immutable environment split

| Environment | Worker | Supabase ref | Runtime KV | Private R2 bucket | Daily UTC cron |
|---|---|---|---|---|---|
| Staging | `buril-lab-storage-backup-staging` | `qpgnomuqdcucjmxrunnw` | `dcaa52254fa6447bbe7c21f54354ad0d` | `buril-lab-cabinet-backups-staging` | `17:15` |
| Production | `buril-lab-storage-backup-production` | `zafxzidbtbryiksemlwc` | `dd6866f35f794a91b0fb5a24cbe57cf3` | `buril-lab-cabinet-backups-production` | `17:45` |

The source bucket is exactly `cabinets`. `SOURCE_POINTER_MODE` must be exactly
`legacy_url` or `private_path`; the Worker never falls back between columns.
The current configs intentionally use `legacy_url` until the private-path app
switch has been reviewed and deployed.

The live account was verified as Workers Free on 2026-08-25. Both committed
configs therefore use `WORKERS_USAGE_PLAN=free_off_only`, declare the Free
50-subrequest ceiling, and intentionally omit Wrangler `limits`, which
Cloudflare documents as a Standard Usage Model feature. Even if the KV flag is
mistakenly changed to true, this profile fails with
`workers_paid_plan_required` after the single KV read and performs no Supabase
or R2 operation. This makes an OFF-first deployment compatible with the
current Free plan; it does not make an actual backup run supported.

A paid activation change must be reviewed separately after live dashboard
evidence confirms Workers Paid: set `WORKERS_USAGE_PLAN=paid`, set
`WORKERS_SUBREQUEST_LIMIT=700`, and add Wrangler
`limits.subrequests=700` in both exact environment configs. The static worst
case is 625, including retry attempts, KV reads, Supabase calls, every R2 write
and verification, and two reserved lock-release calls. A run supports at most
50 image objects, 5 database pages, and 25 recursive Storage-list pages, and
stops starting normal work after 14 minutes so the 15-minute Cron boundary
retains cleanup time. These are support limits, not estimates of platform
capacity. Cloudflare's current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
document Free as 10 ms CPU/50 subrequests and Paid as 10,000 default
subrequests. For a Cron scheduled at intervals of one hour or longer, the
documented CPU and wall-time boundaries are both 15 minutes; that is why this
Worker stops normal work at 14 minutes and reserves cleanup capacity. Its
[Wrangler configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/#limits)
limits custom execution settings to the Standard Usage Model. The paid plan is
a new cost and is not approved by this change.

## Snapshot contract

Each successful run writes, in order:

1. Referenced files: `snapshots/<run-id>/objects/<source-object-path>`
2. Unreferenced files: `snapshots/<run-id>/quarantine/unreferenced/<source-object-path>`
3. `snapshots/<run-id>/manifest.json`
4. `snapshots/<run-id>/manifest.sha256`
5. `snapshots/<run-id>/complete.json`
6. `control/latest.json`

`control/active-lock.json` is acquired and replaced with R2 conditional writes.
An incomplete snapshot has no `complete.json` and must never be used for a
restore. Referenced manifest entries have classification `referenced` and a
`lab` or `user` scope. Orphans are still preserved with classification
`unreferenced`, no owner scope or owner identifier, and a nonzero
`orphanCount`. Default restore tooling may restore only referenced entries;
quarantine recovery always requires separate approval. The manifest never
contains emails, laboratory names, reagent names, or owner identifiers.

## Local verification (no external source calls)

```text
npm run storage-backup:types
npm run storage-backup:check
```

Unit tests use in-memory KV, R2, and HTTP doubles. `config:check` performs only
local Wrangler dry-run builds. `r2-policy.expected.json` is the non-secret
contract for a separate read-only Cloudflare configuration check; local tests
verify its exact names, prefixes, and retention periods but do not claim to
inspect live bucket settings.

`storage-backup:runtime-test` additionally runs the scheduled module inside
Cloudflare's local Workers runtime with actual local KV and R2 bindings. It
proves that the Worker has no public `fetch` handler, exits without touching R2
when the flag is OFF, and refuses source/R2 work when the flag is accidentally
enabled on the committed Free profile.

Read-only evidence on 2026-08-25 found both buckets private, APAC-located, and
empty. That observation is not a permanent expected object count.

The read-only anonymous production baseline recorded on 2026-08-25 is exactly
2 objects and 3,410,853 bytes in `cabinets`. A supervised Staging acceptance
run should recreate only those counts and sizes with synthetic images, then
require the manifest totals to match. It must not copy production paths or
file bodies. `media-products` is outside this Worker's scope even though it is
larger; any request or manifest naming that bucket is a failed acceptance run.

## Conditions before any deploy or activation

- Keep `storage_backup_enabled=false` until Staging has a reviewed secret,
  exact bindings, synthetic files, alerting, and a restore drill.
- Add `SUPABASE_SERVICE_ROLE_KEY` separately to each exact Worker as a secret;
  never place it in Wrangler config, GitHub logs, or this repository. The
  binding name remains for deployment compatibility, but the preferred value
  is a dedicated `sb_secret_...` backend key. New secret keys are sent only in
  the `apikey` header; a legacy key is accepted only when its JWT identifies
  the exact project and `service_role`, in which case it is also sent as a
  Bearer token. Publishable, anonymous, arbitrary, and cross-project keys are
  rejected before KV, Supabase, or R2 calls.
- Confirm both R2 buckets still have public access, custom domains, and public
  development URLs disabled.
- Confirm every image pointer has a reviewed ownership scope. `lab_id` takes
  precedence when both model fields are present; `user_id` is used only when
  `lab_id` is null. Rows with neither value, duplicate pointers, missing files,
  and duplicate Storage UUIDs must all be zero. The Worker preserves orphans in
  quarantine, but production activation still requires `orphanCount=0`.
- Confirm the Supabase `cabinets` bucket has a server-side 20 MiB file-size
  limit and allows only JPEG, PNG, and WebP before production activation. The
  app validates the same limit, MIME, and file signature, but client checks are
  not a security boundary. Replaced, cleared, and deleted photos intentionally
  are not deleted immediately in this change; a reviewed cleanup queue must be
  introduced before automated source deletion.
- Stop activation if current live billing evidence does not show Workers Paid.
  Do not treat the committed profile variable as billing evidence. After the
  upgrade is separately approved and completed, make the reviewed 700-limit
  config changes described above and repeat both Wrangler dry-runs before any
  Staging flag change.
- Confirm the live R2 settings satisfy the
  policy contract in `r2-policy.expected.json`: required user lifecycle
  `expire-snapshots-31-days` applies only to `snapshots/`, deletes after 31
  days, and aborts incomplete multipart uploads after 1 day; Bucket Lock
  `retain-snapshots-30-days` applies only to `snapshots/` for 30 days.
  Cloudflare's managed `Default Multipart Abort Rule` is additionally allowed
  only when it is multipart-only, covers all prefixes, and aborts after 7 days.
  Any other additional rule is drift. `control/` remains outside the required
  user rules so lock and latest-marker replacement continue to work.
- Deploy Staging first, leave the flag OFF, verify the Worker has no public
  route, then enable only Staging for one supervised run. Production deployment
  and enabling require a separate exact-SHA/manual approval.
