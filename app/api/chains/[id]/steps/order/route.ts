import { adminJson, readAdminBody, requireAdminApi, sameOrigin, UUID } from '@/lib/admin'
import { rpcFailure } from '@/lib/rpc'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return adminJson({ error: 'Use the prompt chain tool to make changes.' }, 403)
  const access = await requireAdminApi()
  if ('response' in access) return access.response
  const { id } = await params
  const body = await readAdminBody(request, 2048)
  const order = body?.stepIds
  if (!UUID.test(id) || !Array.isArray(order) || order.length < 1 || order.length > 8
    || !order.every((value) => typeof value === 'string' && UUID.test(value)) || new Set(order).size !== order.length) {
    return adminJson({ error: 'Send the complete new step order.' }, 400)
  }
  const { data, error } = await access.supabase.rpc('prompt_chain_step_reorder_v9', { p_chain_id: id, p_step_ids: order })
  return error ? rpcFailure(error) : adminJson(data)
}
