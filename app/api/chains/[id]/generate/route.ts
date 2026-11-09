import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { adminJson, readAdminBody, requireAdminApi, sameOrigin, UUID } from '@/lib/admin'
import { CAPTION_STYLES, PRESET_IMAGES } from '@/lib/images'
import { isRecord, rpcFailure } from '@/lib/rpc'
import { stepSystemPrompt, type RunStep } from '@/lib/chain-prompts'
import { assessUpload, ChainRunError, runChain, type Observer, type RunErrorCode } from '@/lib/chain-runner'
import type { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

type Supabase = Awaited<ReturnType<typeof createClient>>
const MODELS = ['deepseek-flash', 'deepseek-v4-pro']
const DEFAULT_CONTEXT = 'Run this prompt chain on the image.'

const RUN_ERRORS: Record<RunErrorCode, [number, string]> = {
  provider_auth: [503, 'DeepSeek rejected the API key. Check DEEPSEEK_API_KEY in this Vercel project.'],
  provider_credit: [402, 'The DeepSeek account is out of credit.'],
  provider_busy: [429, 'DeepSeek is busy. Try again shortly.'],
  provider_request: [503, 'DeepSeek could not accept this request.'],
  provider_filtered: [422, 'DeepSeek filtered this image or prompt. Try a different one.'],
  provider_unavailable: [503, 'DeepSeek is temporarily unavailable.'],
  invalid_output: [502, 'A step did not return usable output. Try again or tighten that step’s instructions.'],
  timeout: [504, 'The chain took too long. Try fewer or shorter steps.'],
  telemetry_unavailable: [503, 'The run could not be recorded safely, so it was stopped.'],
  image_not_suitable: [422, 'This photo isn’t suitable for friendly captions. Choose another image.'],
  image_check_failed: [502, 'The photo safety check did not finish. Try again.'],
}

function parseSteps(data: unknown): { chainName: string; token: string; steps: RunStep[] } | null {
  if (!isRecord(data) || typeof data.config_token !== 'string' || !UUID.test(data.config_token) || !isRecord(data.chain)
    || typeof data.chain.name !== 'string' || !Array.isArray(data.steps) || data.steps.length < 1 || data.steps.length > 8) return null
  const steps: RunStep[] = []
  for (const raw of data.steps) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !UUID.test(raw.id) || typeof raw.system_prompt !== 'string' || !raw.system_prompt.trim()
      || typeof raw.model_key !== 'string' || !MODELS.includes(raw.model_key) || raw.provider_slug !== 'deepseek'
      || typeof raw.temperature !== 'number' || !Number.isInteger(raw.max_output_tokens) || !Number.isInteger(raw.position)) return null
    steps.push({ id: raw.id, position: Number(raw.position), name: typeof raw.name === 'string' ? raw.name : `Step ${raw.position}`,
      instruction: raw.system_prompt, model: raw.model_key, temperature: Math.min(2, Math.max(0, raw.temperature)),
      maxOutputTokens: Number(raw.max_output_tokens), supportsVision: raw.supports_vision === true })
  }
  steps.sort((a, b) => a.position - b.position)
  return { chainName: data.chain.name, token: data.config_token, steps }
}

function observer(supabase: Supabase, generationRequestId: string): Observer {
  return {
    async start(call) {
      const { data, error } = await supabase.rpc('begin_llm_response_v7', { p_generation_request_id: generationRequestId, p_step_id: call.stepId,
        p_system_prompt: call.systemPrompt, p_user_prompt: call.userPrompt.slice(0, 4000), p_kind: call.kind })
      if (error || typeof data !== 'string' || !UUID.test(data)) throw Error('telemetry_unavailable')
      return data
    },
    async finish(id, result) {
      const { error } = await supabase.rpc('finish_llm_response_v7', { p_response_id: id, p_status: result.status, p_output: result.output,
        p_error: result.error, p_duration_ms: result.durationMs, p_provider_model: result.model, p_prompt_tokens: result.promptTokens, p_completion_tokens: result.completionTokens })
      if (error) throw Error('telemetry_unavailable')
    },
  }
}

async function captionsFor(supabase: Supabase, generationId: string) {
  const { data } = await supabase.from('captions').select('id,content,position').eq('generation_id', generationId).order('position')
  return Array.isArray(data) ? data : []
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const deadlineAt = Date.now() + 52_000
  if (!sameOrigin(request)) return adminJson({ error: 'Run chains from the prompt chain tool.' }, 403)
  const access = await requireAdminApi()
  if ('response' in access) return access.response
  const { supabase, user } = access
  const { id: chainId } = await params
  const body = await readAdminBody(request, 4096)
  if (!UUID.test(chainId) || !body || typeof body.requestId !== 'string' || !UUID.test(body.requestId) || typeof body.imageId !== 'string'
    || typeof body.style !== 'string' || !CAPTION_STYLES.some((style) => style === body.style) || typeof body.prompt !== 'string') {
    return adminJson({ error: 'Choose an image and tone, then run the chain.' }, 400)
  }
  const context = body.prompt.trim() || DEFAULT_CONTEXT
  if (context.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(context)) return adminJson({ error: 'Keep the run context under 500 characters.' }, 400)
  const preset = PRESET_IMAGES.find((image) => image.id === body.imageId)
  const isUpload = body.imageId.startsWith('upload-') && UUID.test(body.imageId.slice(7))
  if (!preset && !isUpload) return adminJson({ error: 'Choose an image.' }, 400)
  const imageId = isUpload ? body.imageId.toLowerCase() : body.imageId

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) return adminJson({ error: 'DEEPSEEK_API_KEY is not configured for this Vercel project yet.', code: 'api_key_missing' }, 503)

  const resolved = await supabase.rpc('resolve_chain_runtime_v9', { p_chain_id: chainId, p_style: body.style })
  if (resolved.error) return rpcFailure(resolved.error)
  const runtimeConfig = parseSteps(resolved.data)
  if (!runtimeConfig) return adminJson({ error: 'This chain uses a model the server cannot run. Use deepseek-flash or deepseek-v4-pro.' }, 409)
  const { steps, chainName } = runtimeConfig

  // Load the image: real pixels for photos, the curated scene for illustrations.
  let imageText = preset?.scene ?? ''
  let imageDataUrl: string | undefined
  try {
    if (preset?.photo) {
      const bytes = await readFile(path.join(process.cwd(), 'public', preset.src))
      imageDataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`
    } else if (isUpload) {
      const { data: image, error } = await supabase.from('caption_images').select('id,owner_id,storage_path,alt,scene').eq('id', imageId).maybeSingle()
      if (error || !image || image.owner_id !== user.id || image.storage_path !== `${user.id}/${imageId.slice(7)}.jpg`) {
        return adminJson({ error: 'Choose one of your own uploaded photos.' }, 400)
      }
      if (!steps[0].supportsVision) return adminJson({ error: 'Step 1 must use a vision model to read an uploaded photo.' }, 409)
      const file = await supabase.storage.from('caption-uploads').download(image.storage_path)
      if (file.error || !file.data || file.data.size < 4 || file.data.size > 1024 * 1024) return adminJson({ error: 'That photo could not be read.' }, 400)
      const bytes = new Uint8Array(await file.data.arrayBuffer())
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return adminJson({ error: 'That photo is not a valid JPEG.' }, 400)
      imageDataUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`
      imageText = `Owner label (unverified): ${String(image.alt ?? '').slice(0, 300)}`
    }
  } catch {
    return adminJson({ error: 'The image could not be loaded. Try again.' }, 503)
  }

  const finalPrompt = stepSystemPrompt(chainName, steps.at(-1)!, steps.length - 1, steps.length, body.style)
  const reservation = await supabase.rpc('reserve_caption_generation_v5', { p_request_id: body.requestId, p_image_id: imageId, p_prompt: context,
    p_style: body.style, p_system_prompt: finalPrompt, p_model: steps.at(-1)!.model, p_topic: 'other', p_perspective: 'observer' })
  if (reservation.error) return rpcFailure(reservation.error)
  const row: unknown = Array.isArray(reservation.data) ? reservation.data[0] : null
  if (!isRecord(row) || typeof row.id !== 'string' || typeof row.is_new !== 'boolean') return adminJson({ error: 'The run could not start.' }, 503)
  const generationId = row.id
  if (!row.is_new) {
    if (row.status === 'succeeded') return adminJson({ generationId, captions: await captionsFor(supabase, generationId), outputs: [] })
    return adminJson({ error: row.status === 'pending' ? 'This run is still in progress.' : 'This run did not finish. Start a fresh run.' }, 409)
  }
  const fail = async () => { try { await supabase.rpc('fail_caption_generation', { p_generation_id: generationId }) } catch {} }

  const attached = await supabase.rpc('attach_caption_runtime_v7', { p_generation_id: generationId, p_config_token: runtimeConfig.token })
  if (attached.error || typeof attached.data !== 'string') { await fail(); return adminJson({ error: 'The chain selection could not be recorded.' }, 503) }
  const watch = observer(supabase, attached.data)

  try {
    if (isUpload && imageDataUrl) await assessUpload(apiKey, steps[0].model, imageDataUrl, watch, deadlineAt)
    const result = await runChain({ apiKey, chainName, steps, style: body.style, context, imageText, imageDataUrl, observer: watch, deadlineAt })
    const saved = await supabase.rpc('complete_caption_generation_v6', { p_generation_id: generationId, p_captions: result.captions })
    if (saved.error) { await fail(); return rpcFailure(saved.error) }
    return adminJson({ generationId, captions: await captionsFor(supabase, generationId), outputs: result.outputs })
  } catch (error) {
    await fail()
    const code = error instanceof ChainRunError ? error.code : 'provider_unavailable'
    const [status, message] = RUN_ERRORS[code]
    const step = error instanceof ChainRunError && error.stepName ? ` (${error.stepName})` : ''
    console.warn('[prompt-chain-run]', code)
    return adminJson({ error: message + step, code, generationId }, status)
  }
}
