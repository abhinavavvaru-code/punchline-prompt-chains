'use client'
import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
export default function LoginButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  async function signIn() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const { error } = await createClient().auth.signInWithOAuth({
        provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) throw error
    } catch {
      pending.current = false
      setBusy(false)
      setError('Google sign-in could not start. Please try again.')
    }
  }
  return <><button type="button" className="button primary" onClick={signIn} disabled={busy}>{busy ? 'Opening Google…' : 'Continue with Google'}</button>{error && <p className="alert" role="alert">{error}</p>}</>
}
