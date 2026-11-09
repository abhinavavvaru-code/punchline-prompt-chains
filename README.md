# Punchline Prompt Chains — Week 9

A third Punchline app, alongside the public caption app (`week1-hello-world`) and the admin console (`punchline-admin`). It manages the prompt chains that write Punchline captions and runs them for real. All three apps share one Supabase database.

## What it does

- **Access:** only Google-authenticated accounts with `profiles.is_superadmin = true`. Every page, API route and database function checks this separately.
- **Chains:** create, update (name, description, public-mix weight, active) and delete.
- **Steps:** create, update (name, instructions, model, temperature, max tokens, active) and delete, up to 8 per chain. Remaining steps renumber after a delete.
- **Reorder:** ↑/↓ buttons or a "Move to" menu. A single statement rewrites the whole order, and the database rejects it if the step list has changed since you loaded it.
- **Generate:** pick a preset photo or illustration, or one of your own uploads, plus a tone. Step 1 receives the image. Each later step receives only the previous step's output. The final step must return Punchline's three-caption contract (each caption at most 10 words). Results are saved as ordinary captions on the public gallery, linked to the chain.
- **Media per chain:** every run of the chain, with its image, captions, live vote counts and each step's recorded output. Runs made by the public app's weighted random selection appear here too.
- **Themes:** dark, light or system. The choice is stored per browser.

## Safety and data rules

- New chains have weight 0, so they stay tool-only. The public app only picks a chain with positive weight and 1–3 active steps that use enabled DeepSeek models. Any change that would leave the public app with no runnable chain is rejected (`PROMPT_CHAIN_MIX_EMPTY`).
- Deleting a chain or step keeps past generations, captions, prompts and LLM outputs. Their `chain_name` and `step_name` copies remain, and only the live link is set to null.
- Every change writes a before/after row to `admin_record_audit`.
- Generation uses the existing reservation quota: five successful generations per New York day, shared with Punchline, plus the 20-failure cap. It also uses the Week 7 owner-bound runtime snapshot and the begin/finish LLM telemetry. If a run fails, no captions are made up to replace it.
- No service-role key. The DeepSeek key exists only on the server.

## Setup

1. Apply `supabase/migrations/202611080001_prompt_chain_tool.sql` to the shared Punchline project. It must come after the admin repo's `202610260002_week7_operations.sql`.
2. Set these Vercel environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the same public values the other two apps use.
   - `DEEPSEEK_API_KEY`: server-only. Enter it directly in Vercel.
3. Add `https://<deployment>/auth/callback` to Supabase Auth → URL Configuration → Redirect URLs. To allow commit-specific URLs as well, use a wildcard such as `https://punchline-prompt-chains-*.vercel.app/**`.
4. Turn off Vercel Deployment Protection so the app can be viewed in Incognito. App-level login and superadmin checks still apply.

## Checks

```
npm ci
npm run lint && npx tsc --noEmit && npm run build
npm test              # chain prompt/runner unit tests (provider mocked)
```

`supabase/tests/week9_security.sql` is a rollback-only SQL suite for an **isolated** PostgreSQL loaded with the main and admin baselines plus their `local_bootstrap*.sql` helpers. Never run those helpers against production. See `docs/database-week9.md`.
