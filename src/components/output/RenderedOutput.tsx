import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Copy, Download, ChevronDown, Loader2, TriangleAlert, Workflow } from 'lucide-react'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { useRenderStore } from '@/store/render-store'

// Lazy so React Flow + dagre stay out of the initial bundle.
const TopologyModal = lazy(() => import('@/components/topology/TopologyModal'))

type Doc = { kind: string; name: string; source: string; body: string }

function splitDocs(stdout: string): Doc[] {
  if (!stdout.trim()) return []
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
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [topoOpen, setTopoOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const docs = useMemo(() => splitDocs(stdout), [stdout])

  const allSelected = selected.size === 0
  const activeIndices = allSelected
    ? docs.map((_, i) => i)
    : Array.from(selected)
  const activeBody = activeIndices.map((i) => docs[i]?.body).join('---\n')

  const toggleDoc = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((prev) => (prev.size > 0 ? new Set() : new Set(docs.map((_, i) => i))))
  }, [docs])

  useEffect(() => {
    if (!dropdownOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [dropdownOpen])

  function copy() {
    navigator.clipboard.writeText(activeBody).catch(() => {})
  }
  function download() {
    const blob = new Blob([activeBody], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    if (allSelected) {
      a.download = 'rendered.yaml'
    } else {
      const names = activeIndices.map((i) => docs[i]?.name ?? i).join('+')
      a.download = `${names}.yaml`
    }
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
          <button
            className="hp-btn"
            onClick={() => setTopoOpen(true)}
            disabled={docs.length === 0}
            title="View the rendered resources as a topology graph"
          >
            <Workflow size={12} />
            <span>topology</span>
          </button>
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

      <div ref={dropdownRef} className="relative px-3 py-1 border-b border-gv-border shrink-0">
        <button
          className="hp-btn w-full justify-between"
          onClick={() => setDropdownOpen((o) => !o)}
        >
          <span>
            {allSelected
              ? `all (${docs.length})`
              : `${selected.size} of ${docs.length} selected`}
          </span>
          <ChevronDown size={12} className={clsx('transition-transform', dropdownOpen && 'rotate-180')} />
        </button>

        {dropdownOpen && docs.length > 0 && (
          <div className="absolute left-3 right-3 top-full z-10 mt-1 bg-gv-bg2 border border-gv-border max-h-60 overflow-auto">
            <label className="flex items-center gap-2 px-2 py-1 text-[11px] text-gv-fg hover:bg-gv-bg3 cursor-pointer border-b border-gv-border">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="accent-[var(--gv-accent)]"
              />
              <span className="text-gv-dim">all ({docs.length})</span>
            </label>
            {docs.map((d, i) => (
              <label
                key={i}
                className="flex items-center gap-2 px-2 py-1 text-[11px] text-gv-fg hover:bg-gv-bg3 cursor-pointer"
                title={d.source}
              >
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  onChange={() => toggleDoc(i)}
                  className="accent-[var(--gv-accent)]"
                />
                <span>{d.kind}/{d.name}</span>
              </label>
            ))}
          </div>
        )}
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

      {topoOpen && (
        <Suspense fallback={null}>
          <TopologyModal open={topoOpen} onClose={() => setTopoOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
