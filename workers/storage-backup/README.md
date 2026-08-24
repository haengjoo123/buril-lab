# Cabinet image storage backup Worker

This is an OFF-first scheduled Worker. It has no `fetch` handler and cannot be
invoked through a public HTTP route. A run reaches Supabase or R2 only when the
existing `runtime_config` KV object contains the JSON boolean
`"storage_backup_enabled": true`. Missing bindings, KV failures, malformed
objects, and the string `"true"` all stay OFF.

## Immutable environment split

| Environment | Worker | Supabase ref | Runtime KV | Private R2 bucket | Daily UTC cron |
|---|---|---|---|---|---|
| Staging | `buril-lab-storage-backup-staging` | `qpgnomuqdcucjmxrunnw` | `dcaa52254fa6447bbe7c21f54354ad0d` | `buril-lab-cabinet-backups-staging` | `17:15` |
| Production | `buril-lab-storage-backup-production` | `zafxzidbtbryiksemlwc` | `dd6866f35f794a91b0fb5a24cbe57cf3` | `buril-lab-cabinet-backups-production` | `17:45` |

The source bucket is exactly `cabinets`. `SOURCE_POINTER_MODE` must be exactly
`legacy_url` or `private_path`; the Worker never falls back between columns.
The current configs intentionally use `legacy_url` until the private-path app
switch has been reviewed and deployed.

## Snapshot contract

Each successful run writes, in order:

1. `snapshots/<run-id>/objects/<source-object-path>`
2. `snapshots/<run-id>/manifest.json`
3. `snapshots/<run-id>/manifest.sha256`
4. `snapshots/<run-id>/complete.json`
5. `control/latest.json`

`control/active-lock.json` is acquired and replaced with R2 conditional writes.
An incomplete snapshot has no `complete.json` and must never be used for a
restore. The manifest contains object paths and ownership scope type, but not
emails, laboratory names, reagent names, or owner identifiers.

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
  never place it in Wrangler config, GitHub logs, or this repository.
- Confirm both R2 buckets still have public access, custom domains, and public
  development URLs disabled.
- Confirm every image pointer has exactly one reviewed ownership scope (`lab`
  xor `user`) and that duplicate, missing, and orphan objects are all zero.
- Confirm the live R2 settings still match `r2-policy.expected.json`: lifecycle
  `expire-snapshots-31-days` applies only to `snapshots/`, deletes after 31
  days, and aborts incomplete multipart uploads after 1 day; Bucket Lock
  `retain-snapshots-30-days` applies only to `snapshots/` for 30 days.
  `control/` remains outside both rules so lock and latest-marker replacement
  continue to work.
- Deploy Staging first, leave the flag OFF, verify the Worker has no public
  route, then enable only Staging for one supervised run. Production deployment
  and enabling require a separate exact-SHA/manual approval.
