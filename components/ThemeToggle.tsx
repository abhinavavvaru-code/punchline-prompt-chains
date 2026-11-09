'use client'
import { useSyncExternalStore } from 'react'

type Theme = 'dark' | 'light' | 'system'
const OPTIONS: [Theme, string, string][] = [['light', 'Light', '☀'], ['dark', 'Dark', '☾'], ['system', 'System', '◐']]

function subscribe(listener: () => void) {
  window.addEventListener('punchline-theme', listener)
  window.addEventListener('storage', listener)
  return () => { window.removeEventListener('punchline-theme', listener); window.removeEventListener('storage', listener) }
}
function read(): Theme {
  const value = document.documentElement.dataset.theme
  return value === 'dark' || value === 'light' ? value : 'system'
}

function choose(value: Theme) {
  document.documentElement.setAttribute('data-theme', value)
  try { localStorage.setItem('punchline-theme', value) } catch {}
  window.dispatchEvent(new Event('punchline-theme'))
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => 'system' as Theme)
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Color theme">
      {OPTIONS.map(([value, label, icon]) => (
        <button key={value} type="button" role="radio" aria-checked={theme === value} onClick={() => choose(value)} title={`${label} theme`}>
          <span aria-hidden="true">{icon}</span><span className="theme-label">{label}</span>
        </button>
      ))}
    </div>
  )
}
