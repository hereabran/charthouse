import { useChartStore } from '@/store/chart-store'
import { VALUES_OVERRIDE_YAML, VALUES_YAML } from '@/types/chart'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { useState, useEffect, useRef } from 'react'
import clsx from 'clsx'
import { validateValues } from '@/lib/schema-validate'
import type { editor } from 'monaco-editor'
import { Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'

const SCHEMA_FILE = 'values.schema.json'

type Tab = typeof VALUES_YAML | typeof VALUES_OVERRIDE_YAML

export function ValuesPanel() {
  const files = useChartStore((s) => s.files)
  const setFile = useChartStore((s) => s.setFile)
  const addFile = useChartStore((s) => s.addFile)
  const deleteFile = useChartStore((s) => s.deleteFile)
  const [tab, setTab] = useState<Tab>(VALUES_YAML)
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  const hasOverride = VALUES_OVERRIDE_YAML in files
  const hasValues = VALUES_YAML in files
  const schemaJson = files[SCHEMA_FILE]
  const hasSchema = !!schemaJson

  const [markers, setMarkers] = useState<editor.IMarkerData[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!schemaJson) {
      setMarkers([])
      return
    }
    const content = files[tab] ?? ''
    timerRef.current = setTimeout(() => {
      setMarkers(validateValues(schemaJson, content))
    }, 300)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [schemaJson, files[tab], tab])

  function ensureFile(path: Tab) {
    if (!(path in files)) addFile(path, '')
    setTab(path)
  }

  return (
    <div className="hp-panel">
      <div className="hp-panel-header">
        <span>values</span>
        <div className="flex items-center gap-1">
          {hasSchema && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-gv-yellow/20 text-gv-yellow" title="values.schema.json detected — validation active">
              schema
            </span>
          )}
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
              onClick={() => setShowDeleteModal(true)}
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
              markers={hasSchema ? markers : undefined}
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
      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete file?"
        icon={<Trash2 size={12} className="text-gv-red" />}
        width="sm"
        footer={
          <>
            <button className="hp-btn" onClick={() => setShowDeleteModal(false)}>Cancel</button>
            <button
              className="hp-btn hp-btn-danger"
              onClick={() => {
                deleteFile(VALUES_OVERRIDE_YAML)
                setTab(VALUES_YAML)
                setShowDeleteModal(false)
              }}
            >
              Delete
            </button>
          </>
        }
      >
        <p className="text-gv-fg">
          This will permanently delete <span className="text-gv-yellow font-bold">{VALUES_OVERRIDE_YAML}</span>.
        </p>
      </Modal>
    </div>
  )
}
