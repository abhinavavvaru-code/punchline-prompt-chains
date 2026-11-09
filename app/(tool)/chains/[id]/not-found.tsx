import Link from 'next/link'
export default function NotFound() {
  return <section className="panel"><h1>Chain not found</h1><p className="muted">It may have been deleted.</p><Link className="button" href="/">Back to all chains</Link></section>
}
