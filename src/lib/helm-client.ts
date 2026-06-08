import type { RenderRequest, RenderResponse } from '@/types/chart'

export async function renderChart(req: RenderRequest, signal?: AbortSignal): Promise<RenderResponse> {
  const res = await fetch('/api/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  })
  if (!res.ok && res.status !== 422) {
    const text = await res.text()
    throw new Error(`render failed: HTTP ${res.status} ${text}`)
  }
  return (await res.json()) as RenderResponse
}
