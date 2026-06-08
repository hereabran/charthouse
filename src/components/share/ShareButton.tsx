import { useState } from 'react'
import { Check, Link2, Loader2 } from 'lucide-react'
import { useChartStore } from '@/store/chart-store'
import { createShortShare, encodePayloadToHash } from '@/lib/share-client'

export function ShareButton() {
  const files = useChartStore((s) => s.files)
  const releaseName = useChartStore((s) => s.releaseName)
  const namespace = useChartStore((s) => s.namespace)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function share() {
    setBusy(true)
    setDone(false)
    try {
      const payload = { files, releaseName, namespace }
      let url: string
      try {
        const res = await createShortShare(payload)
        if (res) {
          url = `${location.origin}/s/${res.id}`
        } else {
          // Sharing not configured — fall back to URL hash.
          url = `${location.origin}/${encodePayloadToHash(payload)}`
        }
      } catch {
        url = `${location.origin}/${encodePayloadToHash(payload)}`
      }
      await navigator.clipboard.writeText(url)
      setDone(true)
      setTimeout(() => setDone(false), 2000)
      // also surface the URL so the user can grab it without clipboard perms
      window.prompt('Share URL (copied to clipboard):', url)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className="hp-btn" onClick={share} disabled={busy} title="Copy a shareable URL">
      {busy ? <Loader2 size={12} className="animate-spin" /> : done ? <Check size={12} className="text-gv-green" /> : <Link2 size={12} />}
      <span>share</span>
    </button>
  )
}
