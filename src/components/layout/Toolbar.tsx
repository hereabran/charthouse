import { Github, RotateCcw } from 'lucide-react'
import { useChartStore } from '@/store/chart-store'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { UploadButton } from '@/components/upload/UploadDropzone'
import { ShareButton } from '@/components/share/ShareButton'

export function Toolbar() {
  const releaseName = useChartStore((s) => s.releaseName)
  const namespace = useChartStore((s) => s.namespace)
  const setReleaseName = useChartStore((s) => s.setReleaseName)
  const setNamespace = useChartStore((s) => s.setNamespace)
  const resetToSample = useChartStore((s) => s.resetToSample)

  return (
    <header className="flex items-center gap-3 px-3 py-2 border-b border-gv-border bg-gv-bg2 shrink-0">
      <div className="flex items-center gap-2 mr-2">
        <span className="text-gv-accent font-bold tracking-tight">⎈ helm</span>
        <span className="text-gv-dim text-xs">playground</span>
      </div>

      <div className="flex items-center gap-1 text-[11px] text-gv-dim">
        <label htmlFor="release" className="select-none">release</label>
        <input
          id="release"
          className="hp-input w-28"
          value={releaseName}
          onChange={(e) => setReleaseName(e.target.value || 'demo')}
          spellCheck={false}
        />
      </div>
      <div className="flex items-center gap-1 text-[11px] text-gv-dim">
        <label htmlFor="namespace" className="select-none">namespace</label>
        <input
          id="namespace"
          className="hp-input w-28"
          value={namespace}
          onChange={(e) => setNamespace(e.target.value || 'default')}
          spellCheck={false}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <UploadButton />
        <button
          className="hp-btn"
          title="Reset to sample chart"
          onClick={() => {
            if (window.confirm('Replace all files with the sample chart?')) resetToSample()
          }}
        >
          <RotateCcw size={12} />
          <span>reset</span>
        </button>
        <ShareButton />
        <ThemeToggle />
        <a
          className="hp-btn"
          href="https://helm.sh/docs/chart_template_guide/"
          target="_blank"
          rel="noreferrer"
          title="Helm template guide"
        >
          <Github size={12} />
          <span>docs</span>
        </a>
      </div>
    </header>
  )
}
