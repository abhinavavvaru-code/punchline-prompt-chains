import { redirect } from 'next/navigation'
import { getAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Access restricted' }

export default async function AccessDenied() {
  const access = await getAdmin()
  if (!access.user) redirect('/login')
  if (access.isAdmin) redirect('/')
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <p className="eyebrow">PUNCHLINE · PROMPT CHAINS</p>
        <h1>Access restricted.</h1>
        <p className="muted">{access.unavailable ? 'Administrator access could not be checked. Please try again later.' : 'This Google account does not have superadmin access.'}</p>
        <p className="auth-note">{access.user.email}</p>
        <form action="/auth/signout" method="post"><button className="button primary" type="submit">Sign out and use another account</button></form>
      </section>
    </main>
  )
}
