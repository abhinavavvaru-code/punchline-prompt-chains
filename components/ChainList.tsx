'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from '@/lib/client'
import type { Chain, ToolState } from '@/lib/types'

function Badge({ chain }: { chain: Chain }) {
  if (!chain.is_active) return <span className="badge off">Disabled</span>
  if (chain.weight > 0 && chain.public_eligible) return <span className="badge live" title="Used by the public caption app">In public mix · {chain.weight}</span>
  if (chain.weight > 0) return <span className="badge warn" title="Has weight but the public app can only run 1–3 active steps">Weighted, not eligible</span>
  return <span className="badge">Tool only</span>
}

export default function ChainList({ initial }: { initial: ToolState }) {
  const router = useRouter()
  const chains = initial.chains
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    const result = await api<{ chain: Chain }>('/api/chains', { method: 'POST', body: { name: name.trim(), description: description.trim() } })
    if (result.error || !result.data) { setError(result.error ?? 'The chain could not be created.'); setBusy(false); return }
    router.push(`/chains/${result.data.chain.id}?created=1`)
  }

  return (
    <>
      <section className="page-head">
        <div>
          <p className="eyebrow">WEEK 9 · PROMPT CHAIN TOOL</p>
          <h1>Prompt chains</h1>
          <p className="muted lede">Each chain runs its steps in order. Step 1 sees the image, every later step sees the previous step’s output, and the last step writes three captions.</p>
        </div>
        <dl className="stats">
          <div><dt>Chains</dt><dd>{chains.length}</dd></div>
          <div><dt>In public mix</dt><dd>{initial.mix_size}</dd></div>
          <div><dt>Media made</dt><dd>{chains.reduce((sum, chain) => sum + chain.media_count, 0)}</dd></div>
        </dl>
      </section>

      <div className="two-col">
        <section className="panel" aria-labelledby="chains-heading">
          <h2 id="chains-heading">All chains</h2>
          {chains.length === 0 ? <p className="empty">No chains yet. Create your first one.</p> : (
            <ul className="chain-list">
              {chains.map((chain) => (
                <li key={chain.id}>
                  <Link href={`/chains/${chain.id}`} className="chain-card">
                    <div className="chain-card-top"><h3>{chain.name}</h3><Badge chain={chain} /></div>
                    {chain.description && <p className="muted">{chain.description}</p>}
                    <p className="meta">{chain.step_count} step{chain.step_count === 1 ? '' : 's'} · {chain.run_count} run{chain.run_count === 1 ? '' : 's'} · {chain.media_count} caption{chain.media_count === 1 ? '' : 's'}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="create-heading">
          <h2 id="create-heading">New chain</h2>
          <form onSubmit={create} className="form">
            <label>Name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="Describe → joke → captions" /></label>
            <label>Description <span className="optional">optional</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} placeholder="What this chain is for" /></label>
            <p className="hint">New chains start with weight 0, so they stay out of the public caption mix until you give them weight.</p>
            <button className="button primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create chain'}</button>
            {error && <p className="alert" role="alert">{error}</p>}
          </form>
        </section>
      </div>
    </>
  )
}
