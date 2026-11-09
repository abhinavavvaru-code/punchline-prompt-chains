import 'server-only'
import { adminJson } from './admin'

const MESSAGES: Record<string, [number, string]> = {
  PROMPT_CHAIN_MIX_EMPTY: [409, 'That change would leave the public caption app with no runnable chain. Give another eligible chain weight first.'],
  PROMPT_CHAIN_STEP_LIMIT: [409, 'A chain can have at most eight steps.'],
  PROMPT_CHAIN_NOT_RUNNABLE: [409, 'This chain needs 1–8 active steps that use an enabled DeepSeek model.'],
  PROMPT_CHAIN_NOT_FOUND: [404, 'That prompt chain no longer exists.'],
  PROMPT_CHAIN_STEP_NOT_FOUND: [404, 'That step no longer exists in this chain.'],
  STALE_STEP_ORDER: [409, 'The steps changed in another tab. Reload and try the reorder again.'],
  INVALID_PROMPT_CHAIN_MODEL: [400, 'Choose an enabled DeepSeek model.'],
  RUNTIME_SELECTION_LIMIT_REACHED: [429, 'You have started 50 chain runs in the last day. Try again later.'],
  GENERATION_LIMIT_REACHED: [429, 'You have used today’s five caption generations (shared with Punchline). Try again tomorrow.'],
  GENERATION_ATTEMPT_LIMIT_REACHED: [429, 'Too many failed generation attempts today. Try again tomorrow.'],
  REQUEST_ID_REUSED_WITH_DIFFERENT_INPUT: [409, 'This run request was already used. Start a fresh run.'],
  INVALID_CAPTION_IMAGE: [400, 'That image is unavailable or archived. Choose another image.'],
}

export function rpcFailure(error: { code?: string; message?: string }) {
  const known = error.message ? MESSAGES[error.message] : undefined
  if (known) return adminJson({ error: known[1], code: error.message }, known[0])
  if (error.code === '42501') return adminJson({ error: 'Administrator access is required.' }, 403)
  if (error.code === '23505') return adminJson({ error: 'A prompt chain with that name already exists.' }, 409)
  if (error.code === '22023' || error.code === '22P02' || error.code === '23514') return adminJson({ error: 'Check the fields and try again.' }, 400)
  if (error.code === 'P0002') return adminJson({ error: 'That record no longer exists.' }, 404)
  if (['PGRST202', 'PGRST205', '42883'].includes(error.code ?? '')) return adminJson({ error: 'The Week 9 database migration has not been applied yet.' }, 503)
  console.warn('[prompt-chain-rpc]', error.code ?? 'unknown')
  return adminJson({ error: 'The change could not be saved. Please try again.' }, 503)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Copy only known fields with the right JSON types; the database validates bounds again.
export function pick(body: Record<string, unknown>, spec: Record<string, 'string' | 'number' | 'boolean'>) {
  const out: Record<string, unknown> = {}
  for (const [key, type] of Object.entries(spec)) {
    if (!(key in body)) continue
    const value = body[key]
    if (typeof value !== type || (type === 'number' && !Number.isFinite(value))) return null
    out[key] = type === 'string' ? (value as string).replace(/\r\n/g, '\n') : value
  }
  if (Object.keys(body).some((key) => !(key in spec))) return null
  return out
}

export const STEP_FIELDS = { name: 'string', system_prompt: 'string', model_id: 'string', temperature: 'number', max_output_tokens: 'number', is_active: 'boolean' } as const
