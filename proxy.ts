import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value))
      },
    },
  })
  const path = request.nextUrl.pathname
  const publicPath = path === '/login' || path === '/access-denied' || path.startsWith('/auth/')
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null
  let lookupFailed = false
  try { user = (await supabase.auth.getUser()).data.user } catch { lookupFailed = true }
  let target: Response | null = null
  if (!publicPath) {
    if (lookupFailed) target = NextResponse.json({ error: 'Administrator access is temporarily unavailable. Please try again.' }, { status: 503 })
    else if (!user) target = path.startsWith('/api/')
      ? NextResponse.json({ error: 'Sign in with Google to continue.' }, { status: 401 })
      : NextResponse.redirect(new URL('/login', request.url))
    else {
      try {
        const { data: allowed, error } = await supabase.rpc('admin_access_v1')
        if (user.app_metadata.provider !== 'google' || error || allowed !== true) {
          target = path.startsWith('/api/') ? NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 })
            : NextResponse.redirect(new URL('/access-denied', request.url))
        }
      } catch {
        target = NextResponse.json({ error: 'Administrator access is temporarily unavailable. Please try again.' }, { status: 503 })
      }
    }
  }
  if (target instanceof NextResponse) {
    response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie))
    target.headers.set('Cache-Control', 'private, no-store')
    return target
  }
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|captions/|photos/).*)'] }
