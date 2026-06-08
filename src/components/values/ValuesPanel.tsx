import { useChartStore } from '@/store/chart-store'
import { VALUES_OVERRIDE_YAML, VALUES_YAML } from '@/types/chart'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { useState } from 'react'
import clsx from 'clsx'

type Tab = typeof VALUES_YAML | typeof VALUES_OVERRIDE_YAML

export function ValuesPanel() {
  const files = useChartStore((s) => s.files)
  const setFile = useChartStore((s) => s.setFile)
  const addFile = useChartStore((s) => s.addFile)
  const deleteFile = useChartStore((s) => s.deleteFile)
  const [tab, setTab] = useState<Tab>(VALUES_YAML)

  const hasOverride = VALUES_OVERRIDE_YAML in files
  const hasValues = VALUES_YAML in files

  function ensureFile(path: Tab) {
    if (!(path in files)) addFile(path, '')
    setTab(path)
  }

  return (
    <div className="hp-panel">
      <div className="hp-panel-header">
        <span>values</span>
        <div className="flex items-center gap-1">
          <button
            className={clsx(
              'hp-chip cursor-pointer transition-colors',
              tab === VALUES_YAML && 'border-gv-accent text-gv-accent',
            )}
            onClick={() => ensureFile(VALUES_YAML)}
            title="values.yaml"
          >
            values
          </button>
          <button
            className={clsx(
              'hp-chip cursor-pointer transition-colors',
              tab === VALUES_OVERRIDE_YAML && 'border-gv-accent text-gv-accent',
              !hasOverride && 'opacity-70',
            )}
            onClick={() => ensureFile(VALUES_OVERRIDE_YAML)}
            title="values.override.yaml — applied after values.yaml"
          >
            override {hasOverride ? '' : '+'}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between px-3 py-1 border-b border-gv-border text-[11px] text-gv-dim">
          <span>{tab}</span>
          {tab === VALUES_OVERRIDE_YAML && hasOverride && (
            <button
              className="text-gv-dim hover:text-gv-red text-[10px]"
              onClick={() => {
                if (window.confirm('Delete values.override.yaml?')) {
                  deleteFile(VALUES_OVERRIDE_YAML)
                  setTab(VALUES_YAML)
                }
              }}
            >
              remove
            </button>
          )}
        </div>
        <div className="flex-1 min-h-0">
          {(tab === VALUES_YAML && hasValues) || (tab === VALUES_OVERRIDE_YAML && hasOverride) ? (
            <CodeEditor
              path={tab}
              value={files[tab] ?? ''}
              onChange={(v) => setFile(tab, v)}
              ariaLabel={`Editor for ${tab}`}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gv-dim text-xs">
              <button className="hp-btn" onClick={() => ensureFile(tab)}>
                create {tab}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
