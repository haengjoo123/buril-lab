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

## Supervised ephemeral deployment tokens

No Cloudflare write token may remain stored in a GitHub environment between
deployments. Immediately before a supervised run, create separate short-TTL
tokens, install only the token or tokens selected for that run, and then remove
the GitHub secrets and revoke the Cloudflare tokens immediately after the run
finishes, whether it succeeds or fails. The Access service credentials
`STAGING_ACCESS_CLIENT_ID` and `STAGING_ACCESS_CLIENT_SECRET` are a separate
read-only application boundary; they must never be reused as deployment API
tokens.

The manually dispatched Staging workflow always requires
`STAGING_PAGES_EPHEMERAL_TOKEN` with **Cloudflare Pages Edit**. It accepts only
the exact current `main` SHA after the named `Quality and security` workflow
succeeds and requires the confirmation text shown by the workflow. The
`deploy_storage_backup` input defaults to `false`. Only when an operator
explicitly sets it to `true` may the workflow read
`STAGING_WORKER_EPHEMERAL_TOKEN`, which needs **Workers Scripts Edit** and
**Workers KV Storage Read**, plus **Workers R2 Storage Read**, for the OFF-only
Worker deployment and its live verification. Wrangler 4.125.0 verifies the
configured R2 binding with `GET /accounts/{account_id}/r2/buckets/{bucket_name}`
before upload, so omitting the R2 read permission makes deployment fail before
the Worker is changed. Cloudflare documents the permission in its
[API token permission list](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
and accepts R2 read permission for bucket lookup in the
[R2 bucket API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/list/).
The Pages and Worker token values must differ. Production uses a
third temporary secret, `PRODUCTION_PAGES_EPHEMERAL_TOKEN`, with Cloudflare
Pages Edit only; production has no Worker deployment path.

The one-time synthetic acceptance workflow uses a fourth, separately created
token stored only as the Staging environment secret
`STAGING_CLOUDFLARE_STORAGE_BACKUP_ACCEPTANCE_TOKEN`. It needs **Workers
Scripts Edit**, **Workers KV Storage Read**, **Workers KV Storage Edit**, and
**Workers R2 Storage Read** for the exact account. It must expire within 26
hours and should use the shortest practical window. The workflow can run only
from the first attempt of protected `main`; it verifies that the private R2
bucket has no enabled managed or custom public domain, creates two synthetic
PNG objects totalling 3,410,853 bytes in the empty Staging source bucket,
enables the backup switch with a 25-minute automatic expiry, and temporarily
uses a once-per-minute Cron. It accepts only a new complete manifest whose two
body hashes match those exact fixtures. An always-run cleanup restores the
five-value OFF config and the daily `17:15` UTC Cron before removing only the
hash-matched synthetic rows and files. Remove the GitHub secret and revoke the
Cloudflare token immediately after the run, successful or not. This acceptance
token must never be delivered to `production`.

The local supervisor writes and reads back a signed phase journal before it
tells the operator to create any provider credential. The journal advances
sequentially through credential creation, lease materialization, dispatch
intent, exact-run binding, both credential gates, and cleanup-receipt storage.
Its signed lease binds
the exact commit, environment, cleanup receipt, actual Supabase PAT SHA-256,
Cloudflare token-ID hashes, and—for production—the exact cleaned Staging run.
Credential values are accepted only through hidden terminal input or a
non-interactive standard-input pipe. Repository-scoped fallback secrets and
variables are forbidden; only the selected GitHub environment may hold the
temporary values.

Cloudflare control-plane GETs use `scripts/cloudflare-api-get.mjs`. The token
is read from the process environment and is never placed in a command-line
argument. The helper permits only the exact Pages and Staging Worker read
surfaces used by the reviewed workflows, rejects redirects and unexpected
response URLs, accepts only JSON, caps responses at 1 MiB and requests at 30
seconds, and cancels oversized streams. Downstream parsers explicitly remove
`CLOUDFLARE_API_TOKEN` from their environments. Both deployment workflows and
this helper source are pinned by reviewed SHA-256 contracts.

If credential capture or a dispatched run is interrupted, the phase journal
intentionally blocks another lease. `supervise-ephemeral-release.mjs recover`
verifies provider inactivity—or records an explicit operator dashboard
attestation that a specific credential was never created—and reconciles the
exact run. A run that passed both credential gates must appear in the exact
signed cleanup-receipt successor; only a run that did not pass both gates may
end in a signed aborted-lease receipt. Recovery accepts only the journal's
exact base receipt or that single verified successor. Manual journal deletion
is not an approved recovery path. Submitted recovery credentials must hash to
the exact values recorded in the signed journal, and a `NOT_CREATED`
attestation is forbidden after credential hashes have been materialized.

These Cloudflare permissions are account-scoped, not Pages-project,
Worker-script, KV-namespace, or R2-bucket scoped. During its short lifetime, a
Pages token can modify other Pages projects in the account. More importantly,
a Workers Scripts token can modify other Workers and can deploy code with an
R2 runtime binding; omitting R2 API permission does not prevent that deployed
code from using the bound bucket. Short TTL, supervised dispatch, separate
tokens, immediate GitHub-secret removal, and immediate Cloudflare revocation
reduce the exposure window but do not create true environment isolation. A
separate Cloudflare account for Staging remains the open long-term boundary.

When `deploy_storage_backup=true`, the workflow retains the exact post-deploy
checks over six bounded Cloudflare control-plane requests and fails closed
unless the approved state is visible: ten bindings, zero routes, zero custom
domains, `workers.dev=false`, preview URLs disabled, only cron `15 17 * * *`,
only the scheduled handler, and the pinned compatibility date and flag. It
also checks the account, Worker name, environment endpoint, active version,
commit SHA, deployment annotation, and secret-name allow-list. Some of these
service-environment endpoints are used by the pinned Wrangler version but are
not all documented as stable public API surfaces, so an API shape change may
stop the deployment until reviewed. API errors, malformed or oversized
responses, extra response fields, duplicates, and hidden pagination counts
all fail the deployment.

The source bucket is exactly `cabinets`. `SOURCE_POINTER_MODE` must be exactly
`legacy_url` or `private_path`; the Worker never falls back between columns.
The current configs intentionally use `legacy_url` until the private-path app
switch has been reviewed and deployed.

The live account was upgraded to Workers Paid on 2026-08-26 after the dashboard
showed the exact recurring base fee and usage terms. Both committed configs use
`WORKERS_USAGE_PLAN=paid`, declare `WORKERS_SUBREQUEST_LIMIT=700`, and set
Wrangler `limits.subrequests=700`. The runtime KV switch remains fail-closed and
OFF by default, so the paid profile alone does not start a backup.

The static worst
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
limits custom execution settings to the Standard Usage Model.

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
when the flag is OFF, and treats a non-boolean enabled value as OFF.

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
