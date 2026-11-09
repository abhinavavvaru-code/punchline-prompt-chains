'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api } from '@/lib/client'
import { CAPTION_STYLES, imageSrc, PRESET_IMAGES, STYLE_LABELS, type CaptionStyle } from '@/lib/images'
import type { ChainDetail, MediaPage, MediaRow, Model, Step } from '@/lib/types'

const EXAMPLE_STEPS = [
  { name: 'Describe the image', system_prompt: 'Look at the image and describe what is actually visible in two or three plain sentences: the main subject, the setting, and one specific detail.' },
  { name: 'Find the funny angle', system_prompt: 'Read the description from the previous step and write one funny observation about it: an unexpected comparison or a relatable student situation it suggests.' },
  { name: 'Write captions', system_prompt: 'Turn the funny observation from the previous step into five short, funny captions that each work on their own.' },
]

type StepDraft = { name: string; system_prompt: string; model_id: string; temperature: number; max_output_tokens: number; is_active: boolean }
const fmt = (value: string) => new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function StepForm({ initial, models, submitLabel, busy, onSubmit, onCancel }: {
  initial: StepDraft; models: Model[]; submitLabel: string; busy: boolean; onSubmit: (draft: StepDraft) => void; onCancel?: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const set = <K extends keyof StepDraft>(key: K, value: StepDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  return (
    <form className="form step-form" onSubmit={(e) => { e.preventDefault(); onSubmit({ ...draft, name: draft.name.trim(), system_prompt: draft.system_prompt.trim() }) }}>
      <label>Step name<input value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={100} required /></label>
      <label>Instructions (system prompt)
        <textarea value={draft.system_prompt} onChange={(e) => set('system_prompt', e.target.value)} maxLength={4000} rows={5} required />
        <span className="hint">{draft.system_prompt.length}/4000</span></label>
      <div className="form-row">
        <label>Model<select value={draft.model_id} onChange={(e) => set('model_id', e.target.value)} required>
          {models.map((model) => <option key={model.id} value={model.id}>{model.name}{model.supports_vision ? ' · vision' : ''}</option>)}
        </select></label>
        <label>Temperature<input type="number" min={0} max={2} step={0.1} value={draft.temperature} onChange={(e) => set('temperature', Number(e.target.value))} required /></label>
        <label>Max tokens<input type="number" min={128} max={4096} step={1} value={draft.max_output_tokens} onChange={(e) => set('max_output_tokens', Number(e.target.value))} required /></label>
      </div>
      <label className="check"><input type="checkbox" checked={draft.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active (inactive steps are skipped when the chain runs)</label>
      <div className="actions">
        <button className="button primary" disabled={busy || !draft.name.trim() || !draft.system_prompt.trim() || !draft.model_id}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" className="button ghost" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </form>
  )
}

function MediaCard({ row }: { row: MediaRow }) {
  return (
    <article className="media-card">
      {/* eslint-disable-next-line @next/next/no-img-element -- local presets and authenticated private uploads */}
      <img src={imageSrc(row.image)} alt={row.image.alt} loading="lazy" />
      <div className="media-body">
        <p className="meta">{fmt(row.created_at)} · {STYLE_LABELS[row.style as CaptionStyle] ?? row.style} · <span className={`status ${row.status}`}>{row.status}</span>{!row.via_tool && ' · public app'}</p>
        {row.captions.length ? <ol className="captions">{row.captions.map((caption) => (
          <li key={caption.id} className={caption.deleted_at ? 'removed' : ''}>{caption.content}<span className="votes">▲{caption.laughs} ▼{caption.groans}{caption.deleted_at ? ' · removed' : ''}</span></li>
        ))}</ol> : <p className="muted">No captions saved for this run.</p>}
        {row.prompt && <p className="meta">Context: {row.prompt}</p>}
        {row.steps.length > 0 && <details><summary>Step outputs ({row.steps.length} recorded calls)</summary>
          <ol className="trace">{row.steps.map((step) => (
            <li key={step.id}><strong>{step.step_name ?? step.kind}</strong> <span className={`status ${step.status}`}>{step.status}</span>
              {step.duration_ms !== null && <span className="meta"> · {(step.duration_ms / 1000).toFixed(1)}s</span>}
              {step.output && <pre>{step.output}</pre>}{step.error && <p className="text-danger">{step.error}</p>}</li>
          ))}</ol></details>}
      </div>
    </article>
  )
}

export default function ChainEditor({ initial, models, initialMedia }: { initial: ChainDetail; models: Model[]; initialMedia: MediaPage }) {
  const router = useRouter()
  const [chain, setChain] = useState(initial.chain)
  const [steps, setSteps] = useState(initial.steps)
  const [settings, setSettings] = useState({ name: initial.chain.name, description: initial.chain.description, weight: initial.chain.weight, is_active: initial.chain.is_active })
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [adding, setAdding] = useState(initial.steps.length === 0)
  const [media, setMedia] = useState(initialMedia)
  const [uploads, setUploads] = useState<{ id: string; title: string; alt: string }[]>([])
  const [run, setRun] = useState({ imageId: 'photo-coffee', style: 'dry' as CaptionStyle, prompt: '' })
  const [result, setResult] = useState<{ captions: { id: string; content: string }[]; outputs: { name: string; output: string }[] } | null>(null)
  const defaultModel = models.find((m) => m.supports_vision)?.id ?? models[0]?.id ?? ''
  const blankStep: StepDraft = { name: '', system_prompt: '', model_id: defaultModel, temperature: 0.8, max_output_tokens: 1024, is_active: true }

  useEffect(() => {
    let live = true
    api<{ images: { id: string; title: string; alt: string }[] }>('/api/images').then((r) => { if (live && r.data) setUploads(r.data.images) })
    return () => { live = false }
  }, [])

  function flash(kind: 'ok' | 'error', text: string) { setNotice({ kind, text }) }
  function applyDetail(detail: ChainDetail) { setChain(detail.chain); setSteps(detail.steps) }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault()
    setBusy('settings')
    const r = await api<{ chain: ChainDetail['chain'] }>(`/api/chains/${chain.id}`, { method: 'PATCH', body: { ...settings, name: settings.name.trim() } })
    setBusy('')
    if (r.error || !r.data) return flash('error', r.error ?? 'Not saved.')
    setChain(r.data.chain); flash('ok', 'Chain saved.'); router.refresh()
  }

  async function deleteChain() {
    setBusy('delete-chain')
    const r = await api(`/api/chains/${chain.id}`, { method: 'DELETE' })
    if (r.error) { setBusy(''); setConfirm(null); return flash('error', r.error) }
    router.push('/'); router.refresh()
  }

  async function addStep(draft: StepDraft) {
    setBusy('add')
    const r = await api<ChainDetail>(`/api/chains/${chain.id}/steps`, { method: 'POST', body: draft })
    setBusy('')
    if (r.error || !r.data) return flash('error', r.error ?? 'Step not added.')
    applyDetail(r.data); setAdding(false); flash('ok', `Added step ${r.data.steps.length}.`)
  }

  async function addExample() {
    setBusy('example')
    let latest: ChainDetail | undefined
    for (const step of EXAMPLE_STEPS) {
      const r = await api<ChainDetail>(`/api/chains/${chain.id}/steps`, { method: 'POST', body: { ...step, model_id: defaultModel, temperature: 0.8, max_output_tokens: 1024, is_active: true } })
      if (r.error || !r.data) { setBusy(''); if (latest) applyDetail(latest); return flash('error', r.error ?? 'Example steps not added.') }
      latest = r.data
    }
    setBusy(''); if (latest) applyDetail(latest); setAdding(false); flash('ok', 'Added the three example steps.')
  }

  async function updateStep(step: Step, draft: Partial<StepDraft>) {
    setBusy(step.id)
    const r = await api<ChainDetail>(`/api/chains/${chain.id}/steps/${step.id}`, { method: 'PATCH', body: draft })
    setBusy('')
    if (r.error || !r.data) return flash('error', r.error ?? 'Step not saved.')
    applyDetail(r.data); setEditing(null); flash('ok', `Saved “${draft.name ?? step.name}”.`)
  }

  async function deleteStep(step: Step) {
    setBusy(step.id)
    const r = await api<ChainDetail>(`/api/chains/${chain.id}/steps/${step.id}`, { method: 'DELETE' })
    setBusy(''); setConfirm(null)
    if (r.error || !r.data) return flash('error', r.error ?? 'Step not deleted.')
    applyDetail(r.data); flash('ok', `Deleted “${step.name}”. Remaining steps were renumbered.`)
  }

  async function move(step: Step, to: number) {
    const from = steps.findIndex((s) => s.id === step.id)
    if (from < 0 || to < 0 || to >= steps.length || to === from) return
    const order = steps.map((s) => s.id)
    order.splice(to, 0, ...order.splice(from, 1))
    setBusy('order')
    const r = await api<ChainDetail>(`/api/chains/${chain.id}/steps/order`, { method: 'PUT', body: { stepIds: order } })
    setBusy('')
    if (r.error || !r.data) return flash('error', r.error ?? 'Order not saved.')
    applyDetail(r.data); flash('ok', `Moved “${step.name}” to step ${to + 1}.`)
  }

  async function loadMedia(offset: number) {
    const r = await api<MediaPage>(`/api/chains/${chain.id}/media?offset=${offset}`)
    if (r.error || !r.data) return flash('error', r.error ?? 'Media not loaded.')
    const page = r.data
    setMedia((current) => offset === 0 ? page : { ...page, rows: [...current.rows, ...page.rows] })
  }

  async function runChain(event: React.FormEvent) {
    event.preventDefault()
    setBusy('run'); setResult(null); setNotice(null)
    const r = await api<{ captions: { id: string; content: string }[]; outputs: { name: string; output: string }[] }>(`/api/chains/${chain.id}/generate`,
      { method: 'POST', body: { requestId: crypto.randomUUID(), imageId: run.imageId, style: run.style, prompt: run.prompt } })
    setBusy('')
    await loadMedia(0)
    if (r.error || !r.data) return flash('error', r.error ?? 'The chain run failed.')
    setResult(r.data); flash('ok', 'Generated and saved three captions.')
  }

  const activeSteps = steps.filter((s) => s.is_active).length
  const uploadImage = uploads.find((u) => u.id === run.imageId)

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">← All chains</Link></nav>
      <section className="page-head">
        <div>
          <p className="eyebrow">PROMPT CHAIN</p>
          <h1>{chain.name}</h1>
          <p className="muted lede">{chain.description || 'No description.'}</p>
          <p className="meta">{steps.length} step{steps.length === 1 ? '' : 's'} ({activeSteps} active) · updated {fmt(chain.updated_at)} ·{' '}
            {chain.weight > 0 && chain.public_eligible && chain.is_active ? <span className="badge live">In public mix · weight {chain.weight}</span>
              : chain.weight > 0 ? <span className="badge warn">Weighted, but the public app only runs 1–3 active steps</span> : <span className="badge">Tool only (weight 0)</span>}</p>
        </div>
      </section>

      <div className="toast-area" aria-live="polite">{notice && <p className={notice.kind === 'ok' ? 'success' : 'alert'} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}</div>

      <div className="editor-grid">
        <div className="stack">
          <section className="panel" aria-labelledby="steps-heading">
            <div className="panel-head"><h2 id="steps-heading">Steps</h2><span className="meta">Runs top to bottom · max 8</span></div>
            {steps.length === 0 && <div className="empty">
              <p>No steps yet. Add your own, or start from the assignment’s example: describe the image → find something funny → write captions.</p>
              <button className="button" onClick={addExample} disabled={Boolean(busy) || !defaultModel}>{busy === 'example' ? 'Adding…' : 'Add the 3 example steps'}</button>
            </div>}
            <ol className="steps">
              {steps.map((step, index) => (
                <li key={step.id} className={`step${step.is_active ? '' : ' inactive'}`}>
                  <div className="step-num" aria-hidden="true">{step.position}</div>
                  <div className="step-body">
                    {editing === step.id ? (
                      <StepForm models={models} submitLabel="Save step" busy={busy === step.id} onCancel={() => setEditing(null)}
                        initial={{ name: step.name, system_prompt: step.system_prompt, model_id: step.model_id, temperature: Number(step.temperature), max_output_tokens: step.max_output_tokens, is_active: step.is_active }}
                        onSubmit={(draft) => updateStep(step, draft)} />
                    ) : (<>
                      <div className="step-head">
                        <h3>{step.name}</h3>
                        <span className="meta">{step.model_name} · temp {Number(step.temperature)} · {step.max_output_tokens} tokens{step.is_active ? '' : ' · inactive'}</span>
                      </div>
                      <p className="prompt">{step.system_prompt}</p>
                      <p className="meta io">{index === 0 ? 'Input: the image + run context' : `Input: output of step ${index}`} → {index === steps.length - 1 ? 'Output: three captions (saved to Punchline)' : `Output: text for step ${index + 2}`}</p>
                      <div className="step-actions">
                        <button className="icon-button" onClick={() => move(step, index - 1)} disabled={index === 0 || Boolean(busy)} aria-label={`Move ${step.name} up`}>↑</button>
                        <button className="icon-button" onClick={() => move(step, index + 1)} disabled={index === steps.length - 1 || Boolean(busy)} aria-label={`Move ${step.name} down`}>↓</button>
                        <label className="move-to">Move to
                          <select value={index} onChange={(e) => move(step, Number(e.target.value))} disabled={Boolean(busy) || steps.length < 2} aria-label={`Move ${step.name} to position`}>
                            {steps.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}
                          </select></label>
                        <button className="button ghost small" onClick={() => updateStep(step, { is_active: !step.is_active })} disabled={Boolean(busy)}>{step.is_active ? 'Disable' : 'Enable'}</button>
                        <button className="button ghost small" onClick={() => { setEditing(step.id); setConfirm(null) }} disabled={Boolean(busy)}>Edit</button>
                        {confirm === step.id
                          ? <><button className="button danger small" onClick={() => deleteStep(step)} disabled={Boolean(busy)}>Confirm delete</button><button className="button ghost small" onClick={() => setConfirm(null)}>Keep</button></>
                          : <button className="button ghost small danger-text" onClick={() => setConfirm(step.id)} disabled={Boolean(busy)}>Delete</button>}
                      </div>
                    </>)}
                  </div>
                </li>
              ))}
            </ol>
            {steps.length < 8 && (adding
              ? <div className="add-step"><h3>New step {steps.length + 1}</h3><StepForm models={models} initial={blankStep} submitLabel="Add step" busy={busy === 'add'} onSubmit={addStep} onCancel={steps.length ? () => setAdding(false) : undefined} /></div>
              : <button className="button" onClick={() => { setAdding(true); setEditing(null) }} disabled={Boolean(busy)}>+ Add step</button>)}
            {models.length === 0 && <p className="alert">No enabled DeepSeek model is available. Enable one in the admin app’s LLM models catalog.</p>}
          </section>

          <section className="panel" aria-labelledby="media-heading">
            <div className="panel-head"><h2 id="media-heading">Media generated by this chain</h2><span className="meta">{media.total} run{media.total === 1 ? '' : 's'}</span></div>
            {media.rows.length === 0 ? <p className="empty">Nothing yet. Run the chain to generate captions.</p>
              : <div className="media-list">{media.rows.map((row) => <MediaCard key={row.request_id} row={row} />)}</div>}
            {media.rows.length < media.total && <button className="button" onClick={() => loadMedia(media.rows.length)}>Load more</button>}
          </section>
        </div>

        <div className="stack">
          <section className="panel" aria-labelledby="run-heading">
            <h2 id="run-heading">Generate with this chain</h2>
            <form className="form" onSubmit={runChain}>
              <fieldset><legend>Image</legend>
                <div className="image-grid">
                  {PRESET_IMAGES.map((image) => (
                    <label key={image.id} className={`image-option${run.imageId === image.id ? ' selected' : ''}`}>
                      <input type="radio" name="image" value={image.id} checked={run.imageId === image.id} onChange={() => setRun((r) => ({ ...r, imageId: image.id }))} />
                      {/* eslint-disable-next-line @next/next/no-img-element -- bundled preset */}
                      <img src={image.src} alt={image.alt} /><span>{image.title}</span>
                    </label>
                  ))}
                  {uploads.map((image) => (
                    <label key={image.id} className={`image-option${run.imageId === image.id ? ' selected' : ''}`}>
                      <input type="radio" name="image" value={image.id} checked={run.imageId === image.id} onChange={() => setRun((r) => ({ ...r, imageId: image.id }))} />
                      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated private upload */}
                      <img src={imageSrc({ ...image, src: '', uploaded: true })} alt={image.alt} /><span>{image.title || 'My upload'}</span>
                    </label>
                  ))}
                </div>
                <p className="hint">{uploadImage ? 'Your uploaded photo gets a safety check, then step 1 reads its pixels.' : PRESET_IMAGES.find((i) => i.id === run.imageId)?.photo ? 'Step 1 receives the real photo when its model supports vision.' : 'Illustrations are sent to step 1 as their scene description.'}</p>
              </fieldset>
              <label>Tone<select value={run.style} onChange={(e) => setRun((r) => ({ ...r, style: e.target.value as CaptionStyle }))}>
                {CAPTION_STYLES.map((style) => <option key={style} value={style}>{STYLE_LABELS[style]}</option>)}</select></label>
              <label>Extra context <span className="optional">optional</span>
                <textarea rows={2} maxLength={500} value={run.prompt} onChange={(e) => setRun((r) => ({ ...r, prompt: e.target.value }))} placeholder="e.g. finals week in Butler" /></label>
              <button className="button primary" disabled={Boolean(busy) || activeSteps === 0}>{busy === 'run' ? `Running ${activeSteps} step${activeSteps === 1 ? '' : 's'}…` : 'Run chain'}</button>
              <p className="hint">Uses your daily allowance of five caption generations, shared with Punchline. Results are published to the gallery like any other caption.</p>
            </form>
            {result && <div className="run-result" aria-live="polite">
              <h3>Step by step</h3>
              <ol className="trace">{result.outputs.map((output, i) => <li key={i}><strong>{output.name}</strong><pre>{output.output}</pre></li>)}</ol>
              <h3>Saved captions</h3>
              <ol className="captions">{result.captions.map((caption) => <li key={caption.id}>{caption.content}</li>)}</ol>
            </div>}
          </section>

          <section className="panel" aria-labelledby="settings-heading">
            <h2 id="settings-heading">Chain settings</h2>
            <form className="form" onSubmit={saveSettings}>
              <label>Name<input value={settings.name} maxLength={80} required onChange={(e) => setSettings((s) => ({ ...s, name: e.target.value }))} /></label>
              <label>Description<textarea rows={3} maxLength={500} value={settings.description} onChange={(e) => setSettings((s) => ({ ...s, description: e.target.value }))} /></label>
              <label>Public mix weight (0–100)<input type="number" min={0} max={100} step={1} value={settings.weight} onChange={(e) => setSettings((s) => ({ ...s, weight: Number(e.target.value) }))} />
                <span className="hint">0 keeps this chain in the tool only. With weight, Punchline picks it for public generations in proportion to its weight (needs 1–3 active steps).</span></label>
              <label className="check"><input type="checkbox" checked={settings.is_active} onChange={(e) => setSettings((s) => ({ ...s, is_active: e.target.checked }))} /> Active</label>
              <button className="button primary" disabled={Boolean(busy) || !settings.name.trim()}>{busy === 'settings' ? 'Saving…' : 'Save settings'}</button>
            </form>
            <div className="danger-zone">
              <h3>Delete chain</h3>
              <p className="hint">Removes the chain and its steps. Captions it already generated, and their recorded prompts and outputs, stay in Punchline.</p>
              {confirm === 'chain'
                ? <div className="actions"><button className="button danger" onClick={deleteChain} disabled={Boolean(busy)}>{busy === 'delete-chain' ? 'Deleting…' : `Delete “${chain.name}”`}</button><button className="button ghost" onClick={() => setConfirm(null)}>Keep it</button></div>
                : <button className="button ghost danger-text" onClick={() => setConfirm('chain')} disabled={Boolean(busy)}>Delete this chain…</button>}
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
