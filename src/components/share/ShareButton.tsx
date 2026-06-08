import { useRef, useState } from 'react'
import { Check, Copy, Link2, Loader2 } from 'lucide-react'
import { useChartStore } from '@/store/chart-store'
import { createShortShare, encodePayloadToHash } from '@/lib/share-client'
import { Modal } from '@/components/ui/Modal'

export function ShareButton() {
  const files = useChartStore((s) => s.files)
  const releaseName = useChartStore((s) => s.releaseName)
  const namespace = useChartStore((s) => s.namespace)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function share() {
    setBusy(true)
    setCopied(false)
    try {
      const payload = { files, releaseName, namespace }
      let url: string
      try {
        const res = await createShortShare(payload)
        if (res) {
          url = `${location.origin}/s/${res.id}`
        } else {
          url = `${location.origin}/${encodePayloadToHash(payload)}`
        }
      } catch {
        url = `${location.origin}/${encodePayloadToHash(payload)}`
      }
      setShareUrl(url)
      setOpen(true)
      try {
        await navigator.clipboard.writeText(url)
        setCopied(true)
      } catch {
        // clipboard blocked — user can still copy manually
      }
    } finally {
      setBusy(false)
    }
  }

  async function copyAgain() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      inputRef.current?.select()
    }
  }

  return (
    <>
      <button className="hp-btn" onClick={share} disabled={busy} title="Copy a shareable URL">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
        <span>share</span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="share chart"
        icon={<Link2 size={12} />}
        width="lg"
        footer={
          <>
            <button className="hp-btn" onClick={() => setOpen(false)}>
              close
            </button>
            <button className="hp-btn hp-btn-primary" onClick={copyAgain}>
              {copied ? (
                <>
                  <Check size={12} />
                  <span>copied</span>
                </>
              ) : (
                <>
                  <Copy size={12} />
                  <span>copy link</span>
                </>
              )}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-gv-dim">
            Anyone with this link can load your chart, release name, and namespace.
          </p>
          <div className="flex items-stretch gap-1">
            <input
              ref={inputRef}
              type="text"
              readOnly
              value={shareUrl}
              onFocus={(e) => e.target.select()}
              className="hp-input flex-1 font-mono"
            />
            <button
              type="button"
              className="hp-btn"
              onClick={copyAgain}
              title="Copy to clipboard"
              aria-label="Copy"
            >
              {copied ? <Check size={12} className="text-gv-green" /> : <Copy size={12} />}
            </button>
          </div>
          <p className="text-[10px] text-gv-dim leading-snug">
            Short links use the server when configured; otherwise the chart is encoded in
            the URL hash itself.
          </p>
        </div>
      </Modal>
    </>
  )
}
