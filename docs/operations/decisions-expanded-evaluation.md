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

The first v3 tuning run found four wrong classification acceptances, all in
name/formula versus CAS conflicts, before the validation partition was opened.
Candidate v4 adds an independent identity-consistency choice in the SAME
Decisions request. Both the category and identity evidence must pass the
unchanged probability/margin gates. Identity refusal or uncertainty means
UNKNOWN, without a Responses rejudgment. Cache hits must retain and revalidate
both pieces of evidence. v3 remains frozen as `decisionsV3`. The voice v4 prompt
also clarifies count questions and elimination of incompatible distractors.
The original v3 errors and one provider 503 are retained in their own report.

The tuning Responses classification result accepted 175/200, including 25
intentional-abstention cases; all 150 answerable cases were already correct.
Higher raw acceptance at zero wrong is mathematically impossible on that
partition. This does not change the fixed corpus or the strict target.

The v4 tuning-only run also failed: classification accepted 92/200 with three
wrong CAS-conflict acceptances, and only 89/150 answerable cases were correct.
The extra model question is not used by the selected v5 classification policy.
Voice remains at v4. No validation outcomes were opened during these changes.

Classification v5 fetches public PubChem title/formula evidence for a supplied,
checksum-valid CAS. It keeps the original fields intact and supplies the readable
reference separately to the existing category question. Equivalent formula
notations are normalized; a CAS/formula mismatch blocks every non-UNKNOWN choice
at the server even if the model reports probability one. An unavailable,
ambiguous or unsupported reference requires review, without guessing or silently
correcting the input. Name-only inputs do not require a CAS. This is assistance
input consistency, not verification of the actual container or disposal approval.

Each reference lookup is a credential-free GET with a two-second total deadline,
no redirects/retries, schema and 16 KiB body bounds. A bounded process-local cache
holds only successful public identity facts for 15 minutes, never model results.
Reference status/cache metadata accompanies accepted results and is revalidated
on classification cache hits. No reference lookup occurs on legacy, an existing
legacy classification-cache hit, or an unsampled shadow request. Sampled shadow
reference preparation runs inside waitUntil after the legacy response, so it
does not add source latency to the user's response. Report reference cold/warm
latency and unavailable counts separately from app cache and model errors.

Four additional, separately reported identity-boundary guards pair a declared
name with the CAS of a different isomer having the SAME molecular formula.
The arithmetic formula gate alone cannot reject them. They test whether the
model uses the readable reference identity, and are authored before v5 live
evaluation. They do not change the frozen 2,000 inputs or their denominators.

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
