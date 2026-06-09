import { useEffect, useRef } from 'react'
import { buildRenderFiles, useChartStore } from '@/store/chart-store'
import { useRenderStore } from '@/store/render-store'
import { renderChart } from './helm-client'

export function useDebouncedRender(delayMs = 350) {
  const mode = useChartStore((s) => s.mode)
  const files = useChartStore((s) => s.files)
  const singleTemplate = useChartStore((s) => s.singleTemplate)
  const releaseName = useChartStore((s) => s.releaseName)
  const namespace = useChartStore((s) => s.namespace)
  const setLoading = useRenderStore((s) => s.setLoading)
  const setResult = useRenderStore((s) => s.setResult)
  const setError = useRenderStore((s) => s.setError)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const handle = setTimeout(async () => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      setLoading(true)
      try {
        const renderFiles = buildRenderFiles({ mode, files, singleTemplate })
        const res = await renderChart(
          { files: renderFiles, releaseName, namespace },
          ac.signal,
        )
        setResult(res)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message)
      }
    }, delayMs)
    return () => clearTimeout(handle)
  }, [
    mode,
    files,
    singleTemplate,
    releaseName,
    namespace,
    delayMs,
    setLoading,
    setResult,
    setError,
  ])
}
