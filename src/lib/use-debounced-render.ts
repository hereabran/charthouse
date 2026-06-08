import { useEffect, useRef } from 'react'
import { useChartStore } from '@/store/chart-store'
import { useRenderStore } from '@/store/render-store'
import { renderChart } from './helm-client'

export function useDebouncedRender(delayMs = 350) {
  const files = useChartStore((s) => s.files)
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
        const res = await renderChart(
          { files, releaseName, namespace },
          ac.signal,
        )
        setResult(res)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message)
      }
    }, delayMs)
    return () => clearTimeout(handle)
  }, [files, releaseName, namespace, delayMs, setLoading, setResult, setError])
}
