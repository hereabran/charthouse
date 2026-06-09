import { useState } from 'react'
import clsx from 'clsx'
import { Github, RotateCcw, AlertTriangle, FolderTree, FileCode } from 'lucide-react'
import { useChartStore } from '@/store/chart-store'
import { ThemeButton } from '@/components/theme/ThemeButton'
import { ImportButton } from '@/components/ui/ImportButton'
import { UploadButton } from '@/components/upload/UploadDropzone'
import { ShareButton } from '@/components/share/ShareButton'
import { Modal } from '@/components/ui/Modal'

export function Toolbar() {
  const releaseName = useChartStore((s) => s.releaseName)
  const namespace = useChartStore((s) => s.namespace)
  const setReleaseName = useChartStore((s) => s.setReleaseName)
  const setNamespace = useChartStore((s) => s.setNamespace)
  const resetToSample = useChartStore((s) => s.resetToSample)
  const mode = useChartStore((s) => s.mode)
  const setMode = useChartStore((s) => s.setMode)
  const [confirmReset, setConfirmReset] = useState(false)

  return (
    <header className="flex items-center gap-3 px-3 py-2 border-b border-gv-border bg-gv-bg2 shrink-0">
      <div className="flex items-center gap-2 mr-1">
        <span className="text-gv-accent font-bold tracking-tight">⎈ Charthouse</span>
        <span className="text-gv-dim text-xs hidden xl:inline">Helm chart playground</span>
      </div>

      <div
        className="flex items-center border border-gv-border overflow-hidden rounded mr-1"
        role="group"
        aria-label="Editing mode"
      >
        <button
          type="button"
          onClick={() => setMode('chart')}
          className={clsx(
            'flex items-center gap-1 px-2 py-1 text-[11px] transition-colors',
            mode === 'chart' ? 'bg-gv-accent text-gv-bg' : 'text-gv-dim hover:text-gv-fg hover:bg-gv-bg3',
          )}
          title="Edit a full chart with multiple files"
          aria-pressed={mode === 'chart'}
        >
          <FolderTree size={12} />
          <span>Chart</span>
        </button>
        <button
          type="button"
          onClick={() => setMode('single')}
          className={clsx(
            'flex items-center gap-1 px-2 py-1 text-[11px] transition-colors',
            mode === 'single' ? 'bg-gv-accent text-gv-bg' : 'text-gv-dim hover:text-gv-fg hover:bg-gv-bg3',
          )}
          title="Edit a single template file"
          aria-pressed={mode === 'single'}
        >
          <FileCode size={12} />
          <span>Single file</span>
        </button>
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
        <ImportButton />
        <UploadButton />
        <button
          className="hp-btn"
          title="Reset to sample chart"
          onClick={() => setConfirmReset(true)}
        >
          <RotateCcw size={12} />
          <span>reset</span>
        </button>
        <ShareButton />
        <ThemeButton />
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

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="reset chart"
        icon={<RotateCcw size={12} />}
        width="sm"
        footer={
          <>
            <button className="hp-btn" onClick={() => setConfirmReset(false)}>
              cancel
            </button>
            <button
              className="hp-btn hp-btn-danger"
              onClick={() => {
                resetToSample()
                setConfirmReset(false)
              }}
            >
              <RotateCcw size={12} />
              <span>replace all</span>
            </button>
          </>
        }
      >
        <div className="flex gap-3">
          <AlertTriangle size={20} className="text-gv-yellow shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-gv-fg">Replace all files with the sample chart?</p>
            <p className="text-gv-dim">
              Your current chart files will be discarded. This can&apos;t be undone.
            </p>
          </div>
        </div>
      </Modal>
    </header>
  )
}
