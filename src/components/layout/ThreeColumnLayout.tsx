import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

type Props = { left: ReactNode; middle: ReactNode; right: ReactNode }

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

export function ThreeColumnLayout({ left, middle, right }: Props) {
  const [weights, setWeights] = useState<[number, number, number]>(loadWeights)
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

  return (
    <>
      <div className="flex-1 min-h-0 flex flex-col gap-2 p-2 lg:hidden">
        <section className="min-h-[40vh]">{left}</section>
        <section className="min-h-[40vh]">{middle}</section>
        <section className="min-h-[40vh]">{right}</section>
      </div>
      <div
        ref={containerRef}
        className="hidden lg:grid flex-1 min-h-0 p-2"
        style={{ gridTemplateColumns: cols }}
      >
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
    </>
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
