import { requireAdminApi, UUID } from '@/lib/admin'

export const runtime = 'nodejs'
export const maxDuration = 30
const headers = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminApi()
  if ('response' in access) return access.response
  const { id } = await params
  if (!/^upload-[0-9a-f-]{36}$/i.test(id) || !UUID.test(id.slice(7))) return new Response(null, { status: 404, headers })
  try {
    const { data: path, error } = await access.supabase.rpc('admin_image_path_v7', { p_image_id: id })
    if (error || typeof path !== 'string') return new Response(null, { status: 404, headers })
    const parts = path.split('/')
    if (parts.length !== 2 || !UUID.test(parts[0]) || !parts[1].endsWith('.jpg') || !UUID.test(parts[1].slice(0, -4))) {
      return new Response(null, { status: 404, headers })
    }
    const { data: image, error: downloadError } = await access.supabase.storage.from('caption-uploads').download(path, {}, {
      cache: 'no-store', signal: AbortSignal.timeout(8000),
    })
    if (downloadError || !image || image.size < 4 || image.size > 1024 * 1024) return new Response(null, { status: 404, headers })
    const bytes = new Uint8Array(await image.arrayBuffer())
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff
      || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return new Response(null, { status: 404, headers })
    return new Response(bytes, { headers })
  } catch { return new Response(null, { status: 503, headers }) }
}
