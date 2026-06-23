import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

type ModalProps = {
  open: boolean
  onClose: () => void
  title: string
  icon?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: 'sm' | 'md' | 'lg'
}

const widthMap = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
}

export function Modal({ open, onClose, title, icon, children, footer, width = 'md' }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.activeElement as HTMLElement | null
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gv-bg/70 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={cardRef}
        className={`w-full ${widthMap[width]} rounded-md border border-gv-border bg-gv-bg2 shadow-xl flex flex-col max-h-[85vh]`}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gv-border">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-gv-dim">
            {icon}
            <span>{title}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-gv-dim hover:text-gv-fg hover:bg-gv-bg3 focus:outline-none focus:ring-1 focus:ring-gv-accent"
            aria-label="Close"
          >
            <X size={12} />
          </button>
        </div>
        <div className="p-4 overflow-auto text-xs text-gv-fg">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 px-3 py-2 border-t border-gv-border bg-gv-bg2">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
