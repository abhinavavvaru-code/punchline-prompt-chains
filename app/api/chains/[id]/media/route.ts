import { adminJson, requireAdminApi, UUID } from '@/lib/admin'
import { rpcFailure } from '@/lib/rpc'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminApi()
  if ('response' in access) return access.response
  const { id } = await params
  const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
  if (!UUID.test(id) || !Number.isInteger(offset) || offset < 0 || offset > 100_000) return adminJson({ error: 'Choose a valid page.' }, 400)
  const { data, error } = await access.supabase.rpc('prompt_chain_media_v9', { p_chain_id: id, p_limit: 12, p_offset: offset })
  return error ? rpcFailure(error) : adminJson(data)
}
