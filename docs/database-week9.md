# Week 9 database contract

Migration: `supabase/migrations/202611080001_prompt_chain_tool.sql`. It is transactional and additive. It assumes the full main and admin migration order through `202610260002_week7_operations.sql`.

## Schema changes
- `prompt_chain_steps.position` now allows 1–8 (previously 1–3). The `(chain_id, position)` unique constraint is now `DEFERRABLE INITIALLY IMMEDIATE`, so one UPDATE can reorder a whole chain.
- `llm_responses.step_id` and `generation_requests.prompt_chain_id` foreign keys are now `ON DELETE SET NULL`. The stored names and the frozen `config_snapshot` remain.
- `admin_record_audit.action` now also allows `delete` and `reorder`.
- `resolve_caption_runtime_v7` (the public app's random selection) only considers chains with positive weight where `prompt_chain_public_eligible_v9` is true: active, unarchived, 1–3 active steps, and only enabled `deepseek-flash` or `deepseek-v4-pro` models. Its behavior is otherwise identical.

## API
All functions are SECURITY INVOKER `public.*` wrappers around gated `punchline_private.*` implementations. Each implementation calls `require_admin_v1()` first, which requires a Google OAuth session and `profiles.is_superadmin`.

| Function | Purpose |
| --- | --- |
| `prompt_chain_tool_state_v9()` | Chains with step/run/media counts and eligibility, the usable models, and the public mix size |
| `prompt_chain_detail_v9(chain)` | One chain plus its ordered steps |
| `prompt_chain_save_v9(id?, payload)` | Create or update a chain. Fields: `name` (1–80, unique), `description` (≤500), `weight` (integer 0–100), `is_active` |
| `prompt_chain_delete_v9(id)` | Delete the chain and its steps; history is kept |
| `prompt_chain_step_save_v9(chain, id?, payload)` | Create (appended) or update a step. Fields: `name` (1–100), `system_prompt` (1–4000), `model_id`, `temperature` (0–2), `max_output_tokens` (128–4096), `is_active` |
| `prompt_chain_step_delete_v9(id)` | Delete a step and close the position gap |
| `prompt_chain_step_reorder_v9(chain, ids[])` | Exact permutation of the chain's current steps |
| `resolve_chain_runtime_v9(chain, style)` | Freeze one specific chain (1–8 active steps) into an owner-bound selection token. Afterwards, use `attach_caption_runtime_v7`, `begin_llm_response_v7` and `finish_llm_response_v7` |
| `prompt_chain_media_v9(chain, limit≤50, offset)` | The chain's generations with image, captions, votes and per-call outputs |

Errors: validation `22023`, permission `42501`, not found `P0002`, duplicate name `23505`. Business rules raise `P0001` with one of `PROMPT_CHAIN_MIX_EMPTY`, `PROMPT_CHAIN_STEP_LIMIT` or `PROMPT_CHAIN_NOT_RUNNABLE`.

## Verification (isolated PostgreSQL 16, November 8, 2026)
Loaded the main and admin baselines in the documented order, then this migration. Results:

- `week9_security.sql` passed.
- The existing `week7_security.sql`, `admin_security.sql`, `mutable_votes_security.sql` and `public_explore_security.sql` suites still passed with zero errors.

The app was also run end to end against that database through a local Auth/PostgREST stand-in, with DeepSeek mocked. Verified that way: create, edit, reorder and delete persisted after reload; a run's three captions appeared in the public feed; and step outputs were recorded. Real provider calls and the production database are verified separately, after deployment.
