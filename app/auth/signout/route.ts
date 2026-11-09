import { NextResponse } from 'next/server'
import { adminJson, sameOrigin } from '@/lib/admin'
import { createClient } from '@/lib/supabase/server'
export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ error: 'Sign out from the prompt chain tool.' }, 403)
  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) return adminJson({ error: 'Sign-out could not finish. Please try again.' }, 503)
    return NextResponse.redirect(new URL('/login', request.url), 303)
  } catch { return adminJson({ error: 'Sign-out could not finish. Please try again.' }, 503) }
}
