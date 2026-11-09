import { requireAdmin } from '@/lib/admin'
import ChainList from '@/components/ChainList'
import type { ToolState } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Prompt chains' }

export default async function Home() {
  const { supabase } = await requireAdmin()
  const { data, error } = await supabase.rpc('prompt_chain_tool_state_v9')
  if (error || !data) {
    return <section className="panel"><h1>Prompt chains</h1><p className="alert" role="alert">
      {error?.code === 'PGRST202' ? 'The Week 9 database migration has not been applied yet.' : 'Prompt chains could not be loaded. Please reload.'}</p></section>
  }
  return <ChainList initial={data as ToolState} />
}
