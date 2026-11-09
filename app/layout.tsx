import type { Metadata } from 'next'
// Self-hosted (OFL) so builds never depend on reaching Google Fonts.
import '@fontsource-variable/bricolage-grotesque'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Punchline Prompt Chains', template: '%s · Punchline Prompt Chains' },
  description: 'Build, order and test the prompt chains that write Punchline captions.',
  robots: { index: false, follow: false },
}

// Applied before paint so the saved theme never flashes.
const themeScript = `try{var t=localStorage.getItem('punchline-theme');document.documentElement.dataset.theme=['system','light','dark'].includes(t)?t:'system'}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="system" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  )
}
