import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Workflow } from 'lucide-react'
import { useRenderStore } from '@/store/render-store'
import { useChartStore } from '@/store/chart-store'
import { buildTopology, type TopologyNode } from '@/lib/topology'
import { GROUP_THEME } from './groupTheme'
import { TopologyGraphView } from './TopologyGraph'
import { ResourcePanel } from './ResourcePanel'

// Full-window resource-topology overlay. Default export so it can be lazy()-loaded.
export default function TopologyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const stdout = useRenderStore((s) => s.stdout)
  const ok = useRenderStore((s) => s.ok)
  const namespace = useChartStore((s) => s.namespace)
  const graph = useMemo(() => buildTopology(stdout, namespace), [stdout, namespace])
  const [selected, setSelected] = useState<TopologyNode | null>(null)
  const [closing, setClosing] = useState(false)

  // Play the exit animation, then unmount via the parent's onClose.
  const requestClose = useCallback(() => {
    setClosing(true)
    window.setTimeout(onClose, 150)
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, requestClose])

  // Clear the selection whenever the graph changes or the modal reopens.
  useEffect(() => {
    setSelected(null)
  }, [graph, open])

  if (!open) return null

  const groupsPresent = [...new Set(graph.nodes.map((n) => n.group))]
  const empty = graph.nodes.length === 0

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-gv-bg ${closing ? 'ch-overlay-out' : 'ch-overlay-in'}`}
      role="dialog"
      aria-modal="true"
      aria-label="Resource topology"
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gv-border bg-gv-bg2 shrink-0">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-gv-dim">
          <Workflow size={13} className="text-gv-accent" />
          <span>resource topology</span>
          <span className="hp-chip">{graph.nodes.length} resources</span>
          <span className="hp-chip">{graph.edges.length} links</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 flex-wrap justify-end">
            {groupsPresent.map((g) => {
              const t = GROUP_THEME[g]
              return (
                <span key={g} className="flex items-center gap-1 text-[10px] text-gv-dim">
                  <span
                    className="inline-block w-2 h-2 rounded-sm"
                    style={{ background: t.color }}
                  />
                  {t.label}
                </span>
              )
            })}
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="p-1 rounded text-gv-dim hover:text-gv-fg hover:bg-gv-bg3 focus:outline-none focus:ring-1 focus:ring-gv-accent"
            aria-label="Close topology"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 relative">
          {empty ? (
            <div className="absolute inset-0 flex items-center justify-center text-gv-dim text-sm p-6 text-center">
              {!stdout.trim() || !ok
                ? 'Render a chart first — there is no output to graph.'
                : 'No Kubernetes resources found in the rendered output.'}
            </div>
          ) : (
            <TopologyGraphView graph={graph} onSelect={setSelected} />
          )}
        </div>
        <div className="w-[420px] shrink-0 border-l border-gv-border bg-gv-bg2 hidden lg:flex flex-col min-h-0">
          <ResourcePanel node={selected} />
        </div>
      </div>
    </div>
  )
}
