import { adminJson, requireAdminApi } from '@/lib/admin'

// The signed-in administrator's own uploaded photos (made in Punchline or the
// admin app). Generation can only use images the caller owns or presets.
export async function GET() {
  const access = await requireAdminApi()
  if ('response' in access) return access.response
  const { data, error } = await access.supabase.from('caption_images').select('id,title,alt,created_at')
    .eq('owner_id', access.user.id).not('storage_path', 'is', null).is('archived_at', null)
    .order('created_at', { ascending: false }).limit(24)
  if (error) return adminJson({ images: [] })
  return adminJson({ images: data ?? [] })
}
