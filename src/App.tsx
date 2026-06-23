import { useEffect, useState } from 'react'
import { Toolbar } from '@/components/layout/Toolbar'
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout'
import { TemplatePanel } from '@/components/editor/TemplatePanel'
import { SingleTemplatePanel } from '@/components/editor/SingleTemplatePanel'
import { ValuesPanel } from '@/components/values/ValuesPanel'
import { RenderedOutput } from '@/components/output/RenderedOutput'
import { DropOverlay } from '@/components/upload/UploadDropzone'
import { SplashScreen } from '@/components/splash/SplashScreen'
import { useDebouncedRender } from '@/lib/use-debounced-render'
import { useChartStore } from '@/store/chart-store'
import { decodePayloadFromHash, loadShortShare } from '@/lib/share-client'
import type { SharePayload } from '@/types/chart'

function StatusBar() {
  return (
    <footer className="flex items-center justify-between px-3 py-1 border-t border-gv-border bg-gv-bg2 text-[10px] text-gv-dim shrink-0">
      <span>helm template — renders on edit</span>
      <span className="flex items-center gap-3">
        <span>monaco</span>
        <span>gruvbox</span>
      </span>
    </footer>
  )
}

function useLoadFromUrl() {
  const replaceAll = useChartStore((s) => s.replaceAll)
  useEffect(() => {
    const apply = (p: SharePayload) =>
      replaceAll(p.files, {
        release: p.releaseName,
        namespace: p.namespace,
        mode: p.mode ?? 'chart',
        single: p.mode === 'single' && p.single ? { template: p.single.template } : undefined,
      })

    const hashPayload = decodePayloadFromHash(location.hash)
    if (hashPayload) {
      apply(hashPayload)
      history.replaceState(null, '', location.pathname)
      return
    }
    const m = location.pathname.match(/^\/s\/([a-z0-9]{6,16})$/)
    if (m) {
      loadShortShare(m[1])
        .then((p) => {
          if (p) {
            apply(p)
            history.replaceState(null, '', '/')
          }
        })
        .catch(() => {})
    }
  }, [replaceAll])
}

export default function App() {
  const [splashDismissed, setSplashDismissed] = useState(
    () => localStorage.getItem('hp:splash-dismissed') === '1',
  )

  useLoadFromUrl()
  useDebouncedRender(300)
  const mode = useChartStore((s) => s.mode)

  if (!splashDismissed) {
    return <SplashScreen onDismiss={() => setSplashDismissed(true)} />
  }

  return (
    <div className="h-full flex flex-col bg-gv-bg text-gv-fg">
      <Toolbar />
      <ThreeColumnLayout
        labels={[mode === 'single' ? 'Template' : 'Chart', 'Values', 'Rendered']}
        left={
          <div key={mode} className="ch-panel-swap h-full">
            {mode === 'single' ? <SingleTemplatePanel /> : <TemplatePanel />}
          </div>
        }
        middle={<ValuesPanel />}
        right={<RenderedOutput />}
      />
      <StatusBar />
      <DropOverlay />
    </div>
  )
}
