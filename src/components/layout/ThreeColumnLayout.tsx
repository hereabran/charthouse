import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { FileCode, SlidersHorizontal, FileOutput } from 'lucide-react'

type Props = {
  left: ReactNode
  middle: ReactNode
  right: ReactNode
  /** Tab labels for the mobile (< lg) tabbed view, in [left, middle, right] order. */
  labels?: [string, string, string]
}

const STORAGE_KEY = 'hp:layout:weights'
const SPLITTER_PX = 6
const MIN_WEIGHT = 0.25
const DEFAULT_WEIGHTS: [number, number, number] = [1, 1, 1.2]

function loadWeights(): [number, number, number] {
  if (typeof localStorage === 'undefined') return DEFAULT_WEIGHTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_WEIGHTS
    const parsed = JSON.parse(raw)
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      parsed.every((n) => typeof n === 'number' && isFinite(n) && n > MIN_WEIGHT)
    ) {
      return parsed as [number, number, number]
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_WEIGHTS
}

// Tailwind `lg`. We gate the two layouts on this in JS (not just CSS) so only the
// active branch is mounted — otherwise both the tabbed and the grid layout render
// at once and every panel's Monaco editor is instantiated twice.
const LG_QUERY = '(min-width: 1024px)'

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(LG_QUERY).matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(LG_QUERY)
    const onChange = () => setIsDesktop(mq.matches)
    onChange()
    // `change` covers real resizes; `resize` is a belt-and-suspenders fallback
    // for environments that don't dispatch MediaQueryList change events.
    mq.addEventListener('change', onChange)
    window.addEventListener('resize', onChange)
    return () => {
      mq.removeEventListener('change', onChange)
      window.removeEventListener('resize', onChange)
    }
  }, [])
  return isDesktop
}

export function ThreeColumnLayout({ left, middle, right, labels }: Props) {
  const [weights, setWeights] = useState<[number, number, number]>(loadWeights)
  const [mobileTab, setMobileTab] = useState<0 | 1 | 2>(0)
  const isDesktop = useIsDesktop()
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    idx: 0 | 1
    startX: number
    startA: number
    startB: number
    startTotal: number
    contentWidth: number
  } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(weights))
    } catch {
      /* ignore */
    }
  }, [weights])

  function onSplitterDown(idx: 0 | 1) {
    return (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const container = containerRef.current
      if (!container) return
      dragRef.current = {
        idx,
        startX: e.clientX,
        startA: weights[idx],
        startB: weights[idx + 1],
        startTotal: weights[0] + weights[1] + weights[2],
        contentWidth: container.clientWidth - 2 * SPLITTER_PX,
      }
      document.body.style.userSelect = 'none'
    }
  }

  function onSplitterMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d) return
    const deltaW = ((e.clientX - d.startX) * d.startTotal) / d.contentWidth
    let nextA = d.startA + deltaW
    let nextB = d.startB - deltaW
    if (nextA < MIN_WEIGHT) {
      nextB -= MIN_WEIGHT - nextA
      nextA = MIN_WEIGHT
    }
    if (nextB < MIN_WEIGHT) {
      nextA -= MIN_WEIGHT - nextB
      nextB = MIN_WEIGHT
    }
    if (nextA < MIN_WEIGHT || nextB < MIN_WEIGHT) return
    setWeights((w) => {
      const next = [...w] as [number, number, number]
      next[d.idx] = nextA
      next[d.idx + 1] = nextB
      return next
    })
  }

  function onSplitterUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
    document.body.style.userSelect = ''
  }

  function resetSizes() {
    setWeights(DEFAULT_WEIGHTS)
  }

  const cols = `minmax(220px, ${weights[0]}fr) ${SPLITTER_PX}px minmax(220px, ${weights[1]}fr) ${SPLITTER_PX}px minmax(260px, ${weights[2]}fr)`

  const tabLabels = labels ?? ['Template', 'Values', 'Rendered']
  const tabIcons = [FileCode, SlidersHorizontal, FileOutput] as const
  const panes = [left, middle, right]

  // Mobile / tablet (< lg): one full-height panel at a time behind a tab bar. A
  // tall vertical stack would force the page to scroll and starve each Monaco
  // editor of height, so we switch panes instead. Only this OR the grid mounts.
  if (!isDesktop) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div role="tablist" aria-label="Panels" className="flex shrink-0 border-b border-gv-border bg-gv-bg2">
          {tabLabels.map((label, i) => {
            const Icon = tabIcons[i]
            const active = mobileTab === i
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMobileTab(i as 0 | 1 | 2)}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] uppercase tracking-wider transition-colors border-b-2',
                  active
                    ? 'border-gv-accent text-gv-accent'
                    : 'border-transparent text-gv-dim hover:text-gv-fg hover:bg-gv-bg3',
                )}
              >
                <Icon size={13} />
                <span className="truncate">{label}</span>
              </button>
            )
          })}
        </div>
        <div className="flex-1 min-h-0 p-2">
          {panes.map((pane, i) => (
            <div key={i} className={clsx('h-full min-h-0', mobileTab === i ? 'block' : 'hidden')}>
              {pane}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="grid flex-1 min-h-0 p-2" style={{ gridTemplateColumns: cols }}>
      <section className="min-w-0 min-h-0 overflow-hidden">{left}</section>
      <Splitter
        onPointerDown={onSplitterDown(0)}
        onPointerMove={onSplitterMove}
        onPointerUp={onSplitterUp}
        onDoubleClick={resetSizes}
      />
      <section className="min-w-0 min-h-0 overflow-hidden">{middle}</section>
      <Splitter
        onPointerDown={onSplitterDown(1)}
        onPointerMove={onSplitterMove}
        onPointerUp={onSplitterUp}
        onDoubleClick={resetSizes}
      />
      <section className="min-w-0 min-h-0 overflow-hidden">{right}</section>
    </div>
  )
}

type SplitterProps = {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
}

function Splitter({ onPointerDown, onPointerMove, onPointerUp, onDoubleClick }: SplitterProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className="group relative cursor-col-resize flex items-stretch justify-center touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag to resize · double-click to reset"
    >
      <div className="w-px bg-gv-border group-hover:bg-gv-accent group-active:bg-gv-accent transition-colors" />
    </div>
  )
}
