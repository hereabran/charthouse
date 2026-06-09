import { useChartStore } from '@/store/chart-store'
import { SINGLE_TEMPLATE_PATH } from '@/types/chart'
import { CodeEditor } from './CodeEditor'

// Left panel for single-template mode: one template editor, no file tree. The
// template is rendered through a synthesized minimal chart (see buildRenderFiles).
export function SingleTemplatePanel() {
  const singleTemplate = useChartStore((s) => s.singleTemplate)
  const setSingleTemplate = useChartStore((s) => s.setSingleTemplate)

  return (
    <div className="hp-panel">
      <div className="hp-panel-header">
        <span>template</span>
        <span className="hp-chip">single file</span>
      </div>
      <div className="flex items-center justify-between px-3 py-1 border-b border-gv-border text-[11px] text-gv-dim">
        <span className="truncate">{SINGLE_TEMPLATE_PATH}</span>
        <span className="hp-chip">Go template</span>
      </div>
      <div className="flex-1 min-h-0">
        <CodeEditor
          path={SINGLE_TEMPLATE_PATH}
          value={singleTemplate}
          onChange={setSingleTemplate}
          ariaLabel="Single template editor"
        />
      </div>
    </div>
  )
}
