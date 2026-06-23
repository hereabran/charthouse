import { useEffect, useRef, useState } from 'react'
import { Palette, Moon, Sun, Square, Circle, Check, ScanLine } from 'lucide-react'
import clsx from 'clsx'
import { useThemeStore, ACCENT_COLORS } from '@/store/theme-store'
import { useBorderStore } from '@/store/border-store'
import { useCrtStore } from '@/store/crt-store'

export function ThemeButton() {
  const theme = useThemeStore((s) => s.theme)
  const accent = useThemeStore((s) => s.accent)
  const toggleTheme = useThemeStore((s) => s.toggle)
  const setAccent = useThemeStore((s) => s.setAccent)
  const sharp = useBorderStore((s) => s.sharp)
  const toggleBorder = useBorderStore((s) => s.toggle)
  const crt = useCrtStore((s) => s.crt)
  const toggleCrt = useCrtStore((s) => s.toggle)

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button className="hp-btn" onClick={() => setOpen((o) => !o)} title="Theme settings" aria-label="Theme settings">
        <Palette size={12} />
        <span className="hidden sm:inline">theme</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 z-20 w-60 border border-gv-border bg-gv-bg2 shadow-lg p-2 text-xs">
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gv-bg3 text-gv-fg"
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
            <span>{theme === 'dark' ? 'light' : 'dark'} mode</span>
          </button>

          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gv-bg3 text-gv-fg"
            onClick={toggleBorder}
          >
            {sharp ? <Square size={12} /> : <Circle size={12} />}
            <span>{sharp ? 'rounded' : 'sharp'} corners</span>
          </button>

          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gv-bg3 text-gv-fg"
            onClick={toggleCrt}
            aria-pressed={crt}
          >
            <ScanLine size={12} className={clsx(crt && 'text-gv-accent')} />
            <span>CRT lines {crt ? 'off' : 'on'}</span>
          </button>

          <div className="border-t border-gv-border mt-1 pt-1">
            <div className="px-2 py-1 text-[10px] text-gv-dim">accent</div>
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              {ACCENT_COLORS.map((c) => (
                <button
                  key={c.name}
                  aria-label={`Accent ${c.name}`}
                  className={clsx(
                    'w-6 h-6 rounded-full border-2 transition-colors',
                    accent === c.value
                      ? 'border-gv-fg scale-110'
                      : 'border-transparent hover:border-gv-dim',
                  )}
                  style={{ background: `var(--gv-${c.name})` }}
                  title={c.name}
                  onClick={() => {
                    setAccent(c.value)
                  }}
                >
                  {accent === c.value && (
                    <Check size={10} className="mx-auto text-gv-bg" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
