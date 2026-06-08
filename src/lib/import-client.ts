import type { ChartFiles } from '@/types/chart'

export type ImportSource = {
  url: string
  contentType?: string
  format: 'tgz' | 'zip'
  sizeBytes: number
}

export type ImportResult = {
  files: ChartFiles
  source: ImportSource
}

type ImportApiResponse =
  | { ok: true; files: ChartFiles; source: ImportSource }
  | { ok?: false; error: string }

/**
 * Fetches and unpacks a Helm chart archive via the /api/import Go function.
 * The server-side fetch sidesteps CORS and applies an SSRF guard, so callers
 * can pass any public http(s) URL pointing at a .tgz/.tar.gz/.zip.
 */
export async function importChartFromURL(url: string, signal?: AbortSignal): Promise<ImportResult> {
  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  })
  const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as ImportApiResponse
  if (!res.ok || !('ok' in body) || !body.ok) {
    const msg = 'error' in body && body.error ? body.error : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return { files: body.files, source: body.source }
}
