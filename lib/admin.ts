import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from './supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

export const getAdmin = cache(async () => {
  const supabase = await createClient()
  let user: User | null = null
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) return { supabase, user, isAdmin: false, unavailable: false }
    user = data.user
    // app_metadata is issued by Supabase. Never trust editable user_metadata.
    if (user.app_metadata.provider !== 'google') return { supabase, user, isAdmin: false, unavailable: false }
    const { data: allowed, error: accessError } = await supabase.rpc('admin_access_v1')
    return { supabase, user, isAdmin: !accessError && allowed === true, unavailable: Boolean(accessError) }
  } catch {
    return { supabase, user, isAdmin: false, unavailable: true }
  }
})

export async function requireAdmin() {
  const access = await getAdmin()
  if (!access.user) redirect('/login')
  if (!access.isAdmin) redirect('/access-denied')
  return { supabase: access.supabase, user: access.user }
}

export async function requireAdminApi(): Promise<{ supabase: Supabase; user: User } | { response: Response }> {
  try {
    const access = await getAdmin()
    if (access.unavailable) return { response: adminJson({ error: 'Admin access could not be checked. Please try again.' }, 503) }
    if (!access.user) return { response: adminJson({ error: 'Sign in with Google to continue.' }, 401) }
    if (!access.isAdmin) return { response: adminJson({ error: 'This account does not have administrator access.' }, 403) }
    return { supabase: access.supabase, user: access.user }
  } catch {
    return { response: adminJson({ error: 'The admin service is unavailable. Please try again.' }, 503) }
  }
}

export function adminJson(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export function sameOrigin(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function readAdminBody(request: Request, maxBytes = 2048): Promise<Record<string, unknown> | null> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return null
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) { await reader.cancel(); return null }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

export function mutationFailure(error: { code?: string; message?: string }) {
  if (error.code === '42501') return adminJson({ error: 'Administrator access is required.' }, 403)
  if (error.code === '22023') return adminJson({ error: 'Check the fields and try again.' }, 400)
  if (error.message === 'CAPTION_NOT_FOUND') return adminJson({ error: 'That caption no longer exists.' }, 404)
  return adminJson({ error: 'The change could not be saved. Please try again.' }, 503)
}
