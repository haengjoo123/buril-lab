# Expanded Decisions comparison

The operator requested 1,000 voice cases and 1,000 classification cases, using
the existing production server key. Token growth is not an optimization target.
The target is zero wrong acceptances and strictly more acceptances than Responses,
reported independently for each feature. Equal adoption is not a win.

## Frozen corpus and labels

`scripts/decisions-expanded-fixtures.mjs` defines 50 material identities and 20
scenarios per feature. Each feature has 1,000 distinct input objects. Ten target
material identities (200 cases per feature) are for tuning; the other forty
(800 per feature) are held out until policy freeze. Distractor and conflict
identities also stay within the same partition. The original 480 cases remain
the separate regression corpus. They are not added to the new denominator.

Labels are synthetic examples of the existing assistance contract, not human
chemical-safety adjudications. PubChem identity references do not determine
disposal labels. No outputs from the compared models are used as labels. The
1,103-material disposal golden set is not converted into ten-category labels.
Each partition contains both answerable cases and intentional abstentions.
CAS-based families, scenario counts, unique input counts and label provenance
are checked locally without a provider call. `--manifest` emits the frozen hash.

## Policies

v1 and v2 questions remain frozen for historical comparisons. Candidate v3
passes cabinet and other location names separately and supplies one-based shelf
numbers. It spells out chemical-priority and identity-consistency checks while
preserving the ten categories and existing rules. It distinguishes nitrate
from nitrile and sulfate from sulfide and explains the existing ordinary-solid
assistance rule. It does not supply the corpus or its answers to the model.

Acceptance remains probability >=0.90 and margin >=0.20. Models, technical
fallback, refusal routing, downstream review and API contracts stay in place.
Policy changes require another version and evaluation. v3 cache metadata is
isolated from earlier policy versions. The operating mode is controlled by
the existing independent KV setting, never by this experiment.

## Explicit paid execution

Use the protected main CI -> staging -> production release pipeline. Verify
the public production commit before installing an environment-bound one-hour
evaluation grant. Production OpenAI/HMAC secrets remain inside Cloudflare.

```powershell
node scripts/decisions-expanded.mjs --manifest
node scripts/decisions-expanded.mjs --prepare <private-temp-directory>
# Install only grant.json in production ai_decisions_evaluation, TTL 3600.
node scripts/decisions-expanded.mjs --state <private-temp-directory>/private.json --output <output>/tuning.json --split tuning
# Inspect tuning errors, freeze the policy, then run the untouched partition.
node scripts/decisions-expanded.mjs --state <private-temp-directory>/private.json --output <output>/validation.json --split validation
```

The signed endpoint admits only fixed, granted fixture IDs and known backends.
It accepts no caller prompts, inventory, model or credentials. The evaluator
counterbalances backend order, limits concurrent calls to four, and journals
every completed provider result, including failures. No automatic retry is
performed. An explicit `--resume` validates the grant/corpus/backend manifest
and skips all recorded calls. A request with a lost response may already have
run; retain transport diagnostics separately from provider-error counts.

Report Responses, frozen v2 and candidate v3 on exactly the same inputs. Report
raw acceptance, correct acceptance, wrong acceptance, answerable coverage,
abstention, provider errors, p50/p95 and token usage for both partitions and both
features. Errors are not successful abstentions. The maximum number of correct
acceptances is the answerable count: if Responses' raw acceptance exceeds it,
strictly higher raw adoption with zero wrong is infeasible on that partition.
Record this rather than altering labels or removing failures.

After evaluation, match the installed grant ID, remove the grant, confirm that
the signed probe is rejected and unauthenticated production requests return
404, and remove local signing keys. Keep only reports and public metadata.
An offline pass does not replace independent human labels or the required real
24-hour/100-case shadow and sequential activation observations.
