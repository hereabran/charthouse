import { useEffect } from 'react'
import { Toolbar } from '@/components/layout/Toolbar'
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout'
import { TemplatePanel } from '@/components/editor/TemplatePanel'
import { ValuesPanel } from '@/components/values/ValuesPanel'
import { RenderedOutput } from '@/components/output/RenderedOutput'
import { DropOverlay } from '@/components/upload/UploadDropzone'
import { useDebouncedRender } from '@/lib/use-debounced-render'
import { useChartStore } from '@/store/chart-store'
import { decodePayloadFromHash, loadShortShare } from '@/lib/share-client'

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
    const hashPayload = decodePayloadFromHash(location.hash)
    if (hashPayload) {
      replaceAll(hashPayload.files, { release: hashPayload.releaseName, namespace: hashPayload.namespace })
      history.replaceState(null, '', location.pathname)
      return
    }
    const m = location.pathname.match(/^\/s\/([a-z0-9]{6,16})$/)
    if (m) {
      loadShortShare(m[1])
        .then((p) => {
          if (p) {
            replaceAll(p.files, { release: p.releaseName, namespace: p.namespace })
            history.replaceState(null, '', '/')
          }
        })
        .catch(() => {})
    }
  }, [replaceAll])
}

export default function App() {
  useLoadFromUrl()
  useDebouncedRender(300)

  return (
    <div className="h-full flex flex-col bg-gv-bg text-gv-fg">
      <Toolbar />
      <ThreeColumnLayout
        left={<TemplatePanel />}
        middle={<ValuesPanel />}
        right={<RenderedOutput />}
      />
      <StatusBar />
      <DropOverlay />
    </div>
  )
}
