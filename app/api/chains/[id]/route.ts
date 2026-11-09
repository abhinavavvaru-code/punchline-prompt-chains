import { adminJson, readAdminBody, requireAdminApi, sameOrigin, UUID } from '@/lib/admin'
import { pick, rpcFailure } from '@/lib/rpc'

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Context) {
  const access = await requireAdminApi()
  if ('response' in access) return access.response
  const { id } = await params
  if (!UUID.test(id)) return adminJson({ error: 'That prompt chain no longer exists.' }, 404)
  const { data, error } = await access.supabase.rpc('prompt_chain_detail_v9', { p_chain_id: id })
  return error ? rpcFailure(error) : adminJson(data)
}

export async function PATCH(request: Request, { params }: Context) {
  if (!sameOrigin(request)) return adminJson({ error: 'Use the prompt chain tool to make changes.' }, 403)
  const access = await requireAdminApi()
  if ('response' in access) return access.response
  const { id } = await params
  if (!UUID.test(id)) return adminJson({ error: 'That prompt chain no longer exists.' }, 404)
  const body = await readAdminBody(request, 4096)
  const payload = body && pick(body, { name: 'string', description: 'string', weight: 'number', is_active: 'boolean' })
  if (!payload || !Object.keys(payload).length) return adminJson({ error: 'Check the fields and try again.' }, 400)
  const { data, error } = await access.supabase.rpc('prompt_chain_save_v9', { p_id: id, p_payload: payload })
  return error ? rpcFailure(error) : adminJson({ chain: data })
}

export async function DELETE(request: Request, { params }: Context) {
  if (!sameOrigin(request)) return adminJson({ error: 'Use the prompt chain tool to make changes.' }, 403)
  const access = await requireAdminApi()
  if ('response' in access) return access.response
  const { id } = await params
  if (!UUID.test(id)) return adminJson({ error: 'That prompt chain no longer exists.' }, 404)
  const { data, error } = await access.supabase.rpc('prompt_chain_delete_v9', { p_id: id })
  return error ? rpcFailure(error) : adminJson(data)
}
