import { adminJson, readAdminBody, requireAdminApi, sameOrigin } from '@/lib/admin'
import { pick, rpcFailure } from '@/lib/rpc'

export async function GET() {
  const access = await requireAdminApi()
  if ('response' in access) return access.response
  const { data, error } = await access.supabase.rpc('prompt_chain_tool_state_v9')
  return error ? rpcFailure(error) : adminJson(data)
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ error: 'Use the prompt chain tool to make changes.' }, 403)
  const access = await requireAdminApi()
  if ('response' in access) return access.response
  const body = await readAdminBody(request, 4096)
  const payload = body && pick(body, { name: 'string', description: 'string', weight: 'number', is_active: 'boolean' })
  if (!payload) return adminJson({ error: 'Check the fields and try again.' }, 400)
  if (typeof payload.name !== 'string' || !payload.name.trim()) return adminJson({ error: 'Give the chain a name.' }, 400)
  const { data, error } = await access.supabase.rpc('prompt_chain_save_v9', { p_id: null, p_payload: payload })
  return error ? rpcFailure(error) : adminJson({ chain: data }, 201)
}
