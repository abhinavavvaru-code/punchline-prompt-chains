import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'
import ThemeToggle from '@/components/ThemeToggle'

export default async function ToolLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin()
  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <Link href="/" className="brand"><span aria-hidden="true">p.</span><div>Punchline<small>PROMPT CHAINS</small></div></Link>
        <nav className="toplinks" aria-label="Related apps">
          <a href="https://week1-hello-world-eta.vercel.app/explore" target="_blank" rel="noreferrer">Punchline ↗</a>
          <a href="https://punchline-admin.vercel.app/" target="_blank" rel="noreferrer">Admin ↗</a>
        </nav>
        <div className="account">
          <ThemeToggle />
          <span className="account-email" title={user.email ?? ''}>{user.email}</span>
          <form action="/auth/signout" method="post"><button type="submit" className="button ghost small">Sign out</button></form>
        </div>
      </header>
      <main id="main" className="content">{children}</main>
      <footer className="footer">Punchline · A study in funny. <span>Restricted to approved administrators.</span></footer>
    </div>
  )
}
