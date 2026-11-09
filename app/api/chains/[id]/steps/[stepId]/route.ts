import { adminJson, readAdminBody, requireAdminApi, sameOrigin, UUID } from '@/lib/admin'
import { pick, rpcFailure, STEP_FIELDS } from '@/lib/rpc'

type Context = { params: Promise<{ id: string; stepId: string }> }

export async function PATCH(request: Request, { params }: Context) {
  if (!sameOrigin(request)) return adminJson({ error: 'Use the prompt chain tool to make changes.' }, 403)
  const access = await requireAdminApi()
  if ('response' in access) return access.response
  const { id, stepId } = await params
  if (!UUID.test(id) || !UUID.test(stepId)) return adminJson({ error: 'That step no longer exists.' }, 404)
  const body = await readAdminBody(request, 12_000)
  const payload = body && pick(body, STEP_FIELDS)
  if (!payload || !Object.keys(payload).length || (typeof payload.model_id === 'string' && !UUID.test(payload.model_id))) {
    return adminJson({ error: 'Check the fields and try again.' }, 400)
  }
  const { error } = await access.supabase.rpc('prompt_chain_step_save_v9', { p_chain_id: id, p_id: stepId, p_payload: payload })
  if (error) return rpcFailure(error)
  const detail = await access.supabase.rpc('prompt_chain_detail_v9', { p_chain_id: id })
  return detail.error ? rpcFailure(detail.error) : adminJson(detail.data)
}

export async function DELETE(request: Request, { params }: Context) {
  if (!sameOrigin(request)) return adminJson({ error: 'Use the prompt chain tool to make changes.' }, 403)
  const access = await requireAdminApi()
  if ('response' in access) return access.response
  const { id, stepId } = await params
  if (!UUID.test(id) || !UUID.test(stepId)) return adminJson({ error: 'That step no longer exists.' }, 404)
  // Confirm the step belongs to this chain before deleting it.
  const before = await access.supabase.rpc('prompt_chain_detail_v9', { p_chain_id: id })
  if (before.error) return rpcFailure(before.error)
  const steps: { id: string }[] = Array.isArray(before.data?.steps) ? before.data.steps : []
  if (!steps.some((step) => step.id === stepId)) return adminJson({ error: 'That step no longer exists in this chain.' }, 404)
  const { data, error } = await access.supabase.rpc('prompt_chain_step_delete_v9', { p_id: stepId })
  return error ? rpcFailure(error) : adminJson(data)
}
