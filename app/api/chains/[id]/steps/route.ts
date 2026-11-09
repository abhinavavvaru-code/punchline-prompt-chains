import { adminJson, readAdminBody, requireAdminApi, sameOrigin, UUID } from '@/lib/admin'
import { pick, rpcFailure, STEP_FIELDS } from '@/lib/rpc'


export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return adminJson({ error: 'Use the prompt chain tool to make changes.' }, 403)
  const access = await requireAdminApi()
  if ('response' in access) return access.response
  const { id } = await params
  if (!UUID.test(id)) return adminJson({ error: 'That prompt chain no longer exists.' }, 404)
  const body = await readAdminBody(request, 12_000)
  const payload = body && pick(body, STEP_FIELDS)
  if (!payload || typeof payload.name !== 'string' || typeof payload.system_prompt !== 'string' || typeof payload.model_id !== 'string' || !UUID.test(payload.model_id)) {
    return adminJson({ error: 'A step needs a name, instructions and a model.' }, 400)
  }
  const { error } = await access.supabase.rpc('prompt_chain_step_save_v9', { p_chain_id: id, p_id: null, p_payload: payload })
  if (error) return rpcFailure(error)
  const detail = await access.supabase.rpc('prompt_chain_detail_v9', { p_chain_id: id })
  return detail.error ? rpcFailure(detail.error) : adminJson(detail.data, 201)
}
