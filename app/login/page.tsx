import { redirect } from 'next/navigation'
import { getAdmin } from '@/lib/admin'
import ThemeToggle from '@/components/ThemeToggle'
import LoginButton from './LoginButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign in' }

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const access = await getAdmin()
  if (access.isAdmin) redirect('/')
  if (access.user && !access.unavailable) redirect('/access-denied')
  const { error } = await searchParams
  return (
    <main className="auth-screen">
      <div className="auth-theme"><ThemeToggle /></div>
      <section className="auth-card">
        <p className="eyebrow">PUNCHLINE · PROMPT CHAINS</p>
        <h1>Build the joke machine.</h1>
        <p className="muted">Create prompt chains, order their steps, and test what they generate.</p>
        <LoginButton />
        {(error || access.unavailable) && <p className="alert" role="alert">Sign-in could not be completed. Please try again.</p>}
        <p className="auth-note">Google sign-in and superadmin access are required.</p>
      </section>
    </main>
  )
}
