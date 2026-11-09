import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdmin } from '@/lib/admin'
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  if (code) {
    try {
      const supabase = await createClient()
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error) {
        const access = await getAdmin()
        if (access.user) return NextResponse.redirect(new URL(access.isAdmin ? '/' : '/access-denied', url.origin))
      }
    } catch {}
  }
  return NextResponse.redirect(new URL('/login?error=oauth', url.origin))
}
