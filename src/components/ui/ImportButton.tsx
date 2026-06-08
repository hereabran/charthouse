import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as LinkIcon, Loader2 } from 'lucide-react'
import { useChartStore } from '@/store/chart-store'
import { importChartFromURL } from '@/lib/import-client'
import { Modal } from '@/components/ui/Modal'

export function ImportButton() {
  const replaceAll = useChartStore((s) => s.replaceAll)
  const [open, setOpen] = useState(false)
  const [urlValue, setUrlValue] = useState('')
  const [urlBusy, setUrlBusy] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => urlInputRef.current?.focus(), 0)
  }, [open])

  const handleURL = useCallback(async () => {
    const raw = urlValue.trim()
    if (!raw) return
    setUrlBusy(true)
    setUrlError(null)
    try {
      const { files } = await importChartFromURL(raw)
      if (Object.keys(files).length === 0) throw new Error('archive contained no readable files')
      replaceAll(files)
      setUrlValue('')
      setUrlError(null)
      setOpen(false)
    } catch (err) {
      setUrlError((err as Error).message)
    } finally {
      setUrlBusy(false)
    }
  }, [replaceAll, urlValue])

  function openModal() {
    setUrlError(null)
    setOpen(true)
  }

  return (
    <>
      <button className="hp-btn" onClick={openModal} title="Import from URL">
        <LinkIcon size={12} />
        <span>import</span>
      </button>

      <Modal
        open={open}
        onClose={() => {
          if (urlBusy) return
          setOpen(false)
          setUrlError(null)
        }}
        title="import from url"
        icon={<LinkIcon size={12} />}
        width="lg"
        footer={
          <>
            <button
              className="hp-btn"
              disabled={urlBusy}
              onClick={() => { setOpen(false); setUrlError(null) }}
            >
              cancel
            </button>
            <button
              type="submit"
              form="url-import-form"
              disabled={urlBusy || !urlValue.trim()}
              className="hp-btn hp-btn-primary"
            >
              {urlBusy ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  <span>importing…</span>
                </>
              ) : (
                <>
                  <LinkIcon size={12} />
                  <span>import</span>
                </>
              )}
            </button>
          </>
        }
      >
        <form
          id="url-import-form"
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); void handleURL() }}
        >
          <div className="space-y-1">
            <label htmlFor="url-import-input" className="block text-gv-dim">
              chart URL
            </label>
            <input
              ref={urlInputRef}
              id="url-import-input"
              type="url"
              inputMode="url"
              placeholder="https://charts.example.com"
              value={urlValue}
              onChange={(e) => { setUrlValue(e.target.value); setUrlError(null) }}
              disabled={urlBusy}
              className="hp-input w-full font-mono"
            />
          </div>
          <p className="text-[11px] text-gv-dim leading-relaxed">
            Accepts a direct <code className="text-gv-fg2">.tgz</code> /{' '}
            <code className="text-gv-fg2">.tar.gz</code> /{' '}
            <code className="text-gv-fg2">.zip</code> URL, or a Helm repo URL (with or
            without a chart name). Fetched server-side — no CORS, private IPs blocked.
          </p>
          {urlError && (
            <div className="rounded border border-gv-red bg-gv-bg3 px-2 py-1.5 text-gv-red text-[11px]">
              {urlError}
            </div>
          )}
        </form>
      </Modal>
    </>
  )
}
