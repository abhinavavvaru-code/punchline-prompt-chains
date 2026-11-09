export type Chain = {
  id: string; name: string; description: string; weight: number; is_active: boolean; archived_at: string | null
  created_at: string; updated_at: string; step_count: number; active_step_count: number; media_count: number; run_count: number
  public_eligible: boolean
}
export type Step = {
  id: string; chain_id: string; position: number; name: string; system_prompt: string; model_id: string
  temperature: number; max_output_tokens: number; is_active: boolean; created_at: string; updated_at: string
  model_name: string; model_key: string; supports_vision: boolean
}
export type Model = { id: string; name: string; model_key: string; supports_vision: boolean; max_output_tokens: number }
export type ToolState = { chains: Chain[]; models: Model[]; mix_size: number }
export type ChainDetail = { chain: Chain; steps: Step[] }
export type MediaStep = {
  id: string; kind: 'image_assessment' | 'chain_step' | 'captions'; step_id: string | null; step_name: string | null; attempt: number
  status: 'pending' | 'succeeded' | 'failed'; output: string | null; error: string | null; duration_ms: number | null
  prompt_tokens: number | null; completion_tokens: number | null
}
export type MediaRow = {
  request_id: string; generation_id: string; created_at: string; completed_at: string | null; status: 'pending' | 'succeeded' | 'failed'
  style: string; prompt: string; model: string; chain_name: string | null; via_tool: boolean; user_email: string
  image: { id: string; title: string; src: string; alt: string; uploaded: boolean }
  captions: { id: string; content: string; position: number; deleted_at: string | null; laughs: number; groans: number }[]
  steps: MediaStep[]
}
export type MediaPage = { chain_id: string; total: number; limit: number; offset: number; rows: MediaRow[] }
