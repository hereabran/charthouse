import { useState, useEffect } from 'react'
import clsx from 'clsx'
import { Layers, Workflow, FileCode, Share2 } from 'lucide-react'

const DISMISS_KEY = 'hp:splash-dismissed'

const HIGHLIGHTS = [
  {
    icon: Layers,
    title: 'Live render',
    desc: 'Edit templates and watch manifests render as you type',
    color: 'var(--gv-blue)',
  },
  {
    icon: Workflow,
    title: 'Resource topology',
    desc: 'See how the rendered resources connect',
    color: 'var(--gv-aqua)',
  },
  {
    icon: FileCode,
    title: 'Chart or single file',
    desc: 'A full chart, or one quick template',
    color: 'var(--gv-yellow)',
  },
  {
    icon: Share2,
    title: 'Shareable links',
    desc: 'Send a chart with one click',
    color: 'var(--gv-green)',
  },
]

export function SplashScreen({ onDismiss }: { onDismiss: () => void }) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 40)
    return () => clearTimeout(t)
  }, [])

  const shown = visible && !leaving

  const handleDismiss = () => {
    setLeaving(true)
    setTimeout(() => {
      localStorage.setItem(DISMISS_KEY, '1')
      onDismiss()
    }, 420)
  }

  return (
    <div
      className={clsx(
        'fixed inset-0 z-[100] flex justify-center overflow-y-auto bg-gv-bg',
        'transition-opacity duration-500',
        shown ? 'opacity-100' : 'opacity-0',
      )}
    >
      {/* Gruvbox grid + accent glow */}
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(var(--gv-border) 1px, transparent 1px), linear-gradient(90deg, var(--gv-border) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      <div
        className="absolute left-1/2 top-[32%] h-[460px] w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, var(--gv-accent), transparent 68%)', opacity: 0.12 }}
      />

      <div
        className={clsx(
          'relative my-auto flex flex-col items-center px-6 py-10 text-center max-w-xl',
          'transition-all duration-700 ease-out',
          shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
        )}
      >
        {/* Helm wheel */}
        <div
          className={clsx(
            'leading-none text-gv-accent text-6xl sm:text-7xl',
            'transition-all duration-700 ease-out',
            shown ? 'opacity-100 scale-100 rotate-0' : 'opacity-0 scale-50 -rotate-45',
          )}
          style={{ textShadow: '0 0 32px var(--gv-accent)' }}
          aria-hidden="true"
        >
          &#x2388;
        </div>

        <h1 className="mt-5 text-4xl font-bold tracking-tight text-gv-fg">Charthouse</h1>
        <p className="mt-1.5 text-sm text-gv-dim">
          Realtime Helm chart playground — render, map, and share.
        </p>

        {/* Feature highlights */}
        <div className="mt-7 grid w-full max-w-md grid-cols-1 gap-2.5 text-left sm:grid-cols-2">
          {HIGHLIGHTS.map((h, i) => {
            const Icon = h.icon
            return (
              <div
                key={h.title}
                className={clsx(
                  'flex items-start gap-2.5 rounded-md border border-gv-border bg-gv-bg2 p-3',
                  'transition-all ease-out',
                  shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
                )}
                style={{
                  transitionDelay: shown ? `${220 + i * 90}ms` : '0ms',
                  transitionDuration: '480ms',
                }}
              >
                <span className="mt-0.5 shrink-0" style={{ color: h.color }}>
                  <Icon size={18} />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gv-fg">{h.title}</div>
                  <div className="text-[11px] leading-snug text-gv-dim">{h.desc}</div>
                </div>
              </div>
            )
          })}
        </div>

        {/* CTA */}
        <button
          onClick={handleDismiss}
          className={clsx(
            'mt-7 inline-flex items-center gap-2 rounded-md px-7 py-2.5 text-sm font-medium',
            'bg-gv-accent text-gv-bg hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]',
            'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-gv-accent',
          )}
          style={{
            transitionDelay: shown ? '640ms' : '0ms',
            opacity: shown ? 1 : 0,
            transform: shown ? 'translateY(0)' : 'translateY(8px)',
          }}
        >
          Enter the playground &rarr;
        </button>

        {/* Footer chips */}
        <div
          className={clsx(
            'mt-6 flex items-center gap-2 transition-all duration-700 ease-out',
            shown ? 'opacity-100' : 'opacity-0',
          )}
          style={{ transitionDelay: shown ? '780ms' : '0ms' }}
        >
          <span className="hp-chip">no cluster</span>
          <span className="hp-chip">in-browser</span>
          <span className="hp-chip">MIT</span>
        </div>
      </div>
    </div>
  )
}
