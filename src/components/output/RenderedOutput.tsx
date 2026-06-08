import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Copy, Download, Loader2, TriangleAlert } from 'lucide-react'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { useRenderStore } from '@/store/render-store'

type Doc = { kind: string; name: string; source: string; body: string }

function splitDocs(stdout: string): Doc[] {
  if (!stdout.trim()) return []
  // Helm separates docs with "---". Capture "# Source:" comment for context.
  const parts = stdout.split(/^---\s*$/m)
  const docs: Doc[] = []
  for (const raw of parts) {
    const trimmed = raw.replace(/^\s*\n/, '')
    if (!trimmed.trim()) continue
    const sourceMatch = trimmed.match(/^#\s*Source:\s*(.+)$/m)
    const kindMatch = trimmed.match(/^kind:\s*(\S+)/m)
    const nameMatch = trimmed.match(/^\s*name:\s*(\S+)/m)
    docs.push({
      kind: kindMatch?.[1] ?? '—',
      name: nameMatch?.[1] ?? '—',
      source: sourceMatch?.[1] ?? '',
      body: trimmed,
    })
  }
  return docs
}

export function RenderedOutput() {
  const { loading, ok, stdout, stderr, durationMs, error, helmVersion, lastRenderedAt } = useRenderStore()
  const [selected, setSelected] = useState(0)
  const [showAll, setShowAll] = useState(true)

  const docs = useMemo(() => splitDocs(stdout), [stdout])
  const safeSelected = Math.min(selected, Math.max(0, docs.length - 1))
  const activeBody = showAll
    ? docs.map((d) => d.body).join('---\n')
    : docs[safeSelected]?.body ?? ''

  function copy() {
    navigator.clipboard.writeText(activeBody).catch(() => {})
  }
  function download() {
    const blob = new Blob([activeBody], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = showAll ? 'rendered.yaml' : `${docs[safeSelected]?.kind ?? 'doc'}-${docs[safeSelected]?.name ?? safeSelected}.yaml`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="hp-panel">
      <div className="hp-panel-header">
        <span className="flex items-center gap-2">
          rendered
          {loading && <Loader2 size={12} className="animate-spin text-gv-accent" />}
          {!loading && !ok && <TriangleAlert size={12} className="text-gv-red" />}
        </span>
        <div className="flex items-center gap-2">
          {helmVersion && <span className="hp-chip">{helmVersion}</span>}
          {lastRenderedAt && <span className="hp-chip">{durationMs} ms</span>}
          <button className="hp-btn" onClick={copy} title="Copy">
            <Copy size={12} />
          </button>
          <button className="hp-btn" onClick={download} title="Download">
            <Download size={12} />
          </button>
        </div>
      </div>

      {(error || stderr.trim()) && (
        <div className="px-3 py-1.5 text-[11px] border-b border-gv-border bg-gv-bg3 text-gv-red whitespace-pre-wrap font-mono max-h-32 overflow-auto shrink-0">
          {error || stderr}
        </div>
      )}

      <div className="flex items-center gap-1 px-3 py-1 border-b border-gv-border overflow-x-auto shrink-0">
        <button
          className={clsx(
            'hp-chip whitespace-nowrap cursor-pointer transition-colors',
            showAll && 'border-gv-accent text-gv-accent',
          )}
          onClick={() => setShowAll(true)}
        >
          all ({docs.length})
        </button>
        {docs.map((d, i) => (
          <button
            key={i}
            className={clsx(
              'hp-chip whitespace-nowrap cursor-pointer transition-colors',
              !showAll && i === safeSelected && 'border-gv-accent text-gv-accent',
            )}
            onClick={() => { setShowAll(false); setSelected(i) }}
            title={d.source}
          >
            {d.kind}/{d.name}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0">
        <CodeEditor
          path="rendered.yaml"
          value={activeBody || (loading ? '' : '# no output')}
          onChange={() => {}}
          readOnly
          ariaLabel="Rendered output"
        />
      </div>
    </div>
  )
}
