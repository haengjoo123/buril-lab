# OpenAI API migration decision ledger

The approved implementation covers reagent search after transcription and auxiliary classification after the existing rules return UNKNOWN. The existing Cloudflare OpenAI key and HMAC stay server-side. There is no SDK or model migration. The user approved the implementation, deployment in legacy mode and server evaluation. On 2026-11-21 the user confirmed that independent human labels are currently unavailable.

| Stage | Product decision | Verification |
|---|---|---|
| Voice candidate resolution | Use grouped bottle evidence with Responses. Validate positive shelf, identity and hydration constraints before accepting a returned ID. Compare with the same evidence and safeguards in Decisions at 0.85 and margin 0.20. | Public selection entry point, 120-item limit, contradictions, duplicates, abstention, shadow isolation and signed server comparison. |
| Auxiliary classification | On a cache miss use the previously frozen acid/hydroxide cue to choose one primary provider. Supply v6 evidence, retain identity blocks and final human review. | Both API aliases, provider request counts, validation, separate accepted-result cache, technical failures and no rejudgment. |
| Independent evaluation | Freeze new inputs and blind review forms before comparing confirmed labels. Prior synthetic results are regression data. Ordinary production mode is legacy. | Register only fixed fixture IDs on the signed endpoint. Check the real key on regression cases and keep human acceptance pending until labels are provided. |

| Guidance reviewed | Application decision and evidence |
|---|---|
| Model selection, instruction file naming, moving from Chat Completions | Existing direct OpenAI Responses SDK and HTTP Decisions adapter both support gpt-6-luna. Stored evidence, structured output contracts and instructions already exist in the service. |
| Structured outputs, maximum output tokens, verbosity | Retain the existing Zod schemas, measured limits of 500 voice / 400 classification, and short application output. |
| Privacy, Zero Data Retention, residency, processing tiers | Responses uses store=false and HMAC user IDs. Organization-level retention, region and tier are unverified. This change uses the existing account settings. |
| Prompt cache keys, retention, breakpoints and diagnostics | Provider usage is logged when available. Existing application caches separate adopted policies. Token spend is secondary to correctness. |
| State management, instruction persistence, context compaction, assistant phases | Both requests are stateless, single-turn selections with their full instructions. |
| Reasoning effort, encrypted items, preservation, summaries and preambles | Existing Responses adapter uses reasoning effort none. No conversation replay or reasoning export is needed. |
| Streaming, WebSockets | Both endpoints return a single validated choice. No partial result reaches a user or cache. |
| Tools, tool choice, search, parallel/programmatic calls and tool interfaces | No model tools are required. Inventory and reference facts are prepared by the server before selecting a provider. |

SDK settings are covered by functions/api/ai/_openai.ts. Responses supports strict structured outputs and Decisions accepts enumerated choice questions. [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) · [Decisions reference](https://developers.openai.com/api/reference/resources/decisions/methods/create)
