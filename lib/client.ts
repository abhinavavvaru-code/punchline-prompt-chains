// Small JSON fetch helper for client components. Returns the server's safe
// error message instead of throwing raw network details at the user.
export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<{ data?: T; error?: string }> {
  try {
    const response = await fetch(url, {
      method: init?.method ?? 'GET', cache: 'no-store',
      headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const json: unknown = await response.json().catch(() => null)
    const record = json && typeof json === 'object' ? json as Record<string, unknown> : {}
    if (!response.ok) return { error: typeof record.error === 'string' ? record.error : `Request failed (${response.status}).` }
    return { data: json as T }
  } catch {
    return { error: 'Network error. Check your connection and try again.' }
  }
}
