import { notFound } from 'next/navigation'
import { requireAdmin, UUID } from '@/lib/admin'
import ChainEditor from '@/components/ChainEditor'
import type { ChainDetail, MediaPage, ToolState } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: (await params).id ? 'Edit chain' : 'Chain' }
}

export default async function ChainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const { supabase } = await requireAdmin()
  const [detail, state, media] = await Promise.all([
    supabase.rpc('prompt_chain_detail_v9', { p_chain_id: id }),
    supabase.rpc('prompt_chain_tool_state_v9'),
    supabase.rpc('prompt_chain_media_v9', { p_chain_id: id, p_limit: 12, p_offset: 0 }),
  ])
  if (detail.error?.code === 'P0002') notFound()
  if (detail.error || state.error || media.error) {
    return <section className="panel"><h1>Prompt chain</h1><p className="alert" role="alert">This chain could not be loaded. Please reload.</p></section>
  }
  return <ChainEditor initial={detail.data as ChainDetail} models={(state.data as ToolState).models} initialMedia={media.data as MediaPage} />
}
