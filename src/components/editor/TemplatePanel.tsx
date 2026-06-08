import { useChartStore, isValuesFile } from '@/store/chart-store'
import { CodeEditor } from './CodeEditor'
import { FileTree } from './FileTree'

export function TemplatePanel() {
  const files = useChartStore((s) => s.files)
  const activePath = useChartStore((s) => s.activePath)
  const setFile = useChartStore((s) => s.setFile)

  return (
    <div className="hp-panel">
      <div className="hp-panel-header">
        <span>chart</span>
        <span className="hp-chip">{Object.keys(files).length} files</span>
      </div>
      <div className="flex-1 min-h-0 grid grid-rows-[minmax(120px,40%)_1fr]">
        <div className="border-b border-gv-border min-h-0 overflow-hidden flex flex-col">
          <FileTree />
        </div>
        <div className="min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-3 py-1 border-b border-gv-border text-[11px] text-gv-dim">
            <span className="truncate">{activePath || '(no file selected)'}</span>
            {activePath && isValuesFile(activePath) && (
              <span className="hp-chip">values file</span>
            )}
          </div>
          <div className="flex-1 min-h-0">
            {activePath ? (
              <CodeEditor
                path={activePath}
                value={files[activePath] ?? ''}
                onChange={(v) => setFile(activePath, v)}
                ariaLabel={`Editor for ${activePath}`}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gv-dim text-xs">
                Select a file from the tree, or create one with the + buttons.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
