import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  File,
  FileBadge,
  FileCode,
  FileJson,
  FileText,
  FilePen,
  FilePlus,
  FileX,
  FolderPlus,
  Trash2,
} from 'lucide-react'
import clsx from 'clsx'
import { useChartStore, isValuesFile, isChartYaml } from '@/store/chart-store'
import { Modal } from '@/components/ui/Modal'

type Node =
  | { kind: 'dir'; name: string; path: string; children: Node[] }
  | { kind: 'file'; name: string; path: string }

function iconForFile(name: string): ReactNode {
  if (isChartYaml(name)) return <FileBadge size={12} className="text-gv-aqua shrink-0" />
  if (name.endsWith('.yaml') || name.endsWith('.yml'))
    return <FileCode size={12} className="text-gv-yellow shrink-0" />
  if (name.endsWith('.json')) return <FileJson size={12} className="text-gv-blue shrink-0" />
  if (name.endsWith('.tpl')) return <FileText size={12} className="text-gv-green shrink-0" />
  if (name.endsWith('.md')) return <FilePen size={12} className="text-gv-green shrink-0" />
  if (name.endsWith('.helmignore')) return <FileX size={12} className="text-gv-dim shrink-0" />
  if (name.endsWith('.txt')) return <FileText size={12} className="text-gv-dim shrink-0" />
  return <File size={12} className="text-gv-fg shrink-0" />
}

function buildTree(paths: string[]): Node[] {
  const root: Node[] = []
  const dirMap = new Map<string, Node[]>()
  dirMap.set('', root)

  function ensureDir(path: string): Node[] {
    if (dirMap.has(path)) return dirMap.get(path)!
    const parts = path.split('/')
    const name = parts.pop()!
    const parentPath = parts.join('/')
    const parent = ensureDir(parentPath)
    const children: Node[] = []
    parent.push({ kind: 'dir', name, path, children })
    dirMap.set(path, children)
    return children
  }

  for (const p of [...paths].sort()) {
    const segs = p.split('/')
    const fileName = segs.pop()!
    const dirPath = segs.join('/')
    const target = dirPath ? ensureDir(dirPath) : root
    target.push({ kind: 'file', name: fileName, path: p })
  }
  // Sort: dirs first, then files, alpha
  const sort = (nodes: Node[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) if (n.kind === 'dir') sort(n.children)
  }
  sort(root)
  return root
}

export function FileTree() {
  const files = useChartStore((s) => s.files)
  const activePath = useChartStore((s) => s.activePath)
  const setActivePath = useChartStore((s) => s.setActivePath)
  const addFile = useChartStore((s) => s.addFile)
  const deleteFile = useChartStore((s) => s.deleteFile)
  const deleteFolder = useChartStore((s) => s.deleteFolder)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ templates: true })
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; kind: 'file' | 'folder' } | null>(null)
  const [createMode, setCreateMode] = useState<{ kind: 'file' | 'folder'; parent: string } | null>(null)
  const [createValue, setCreateValue] = useState('')
  const [createError, setCreateError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (createMode) {
      setCreateError('')
      const ref = createMode.kind === 'file' ? fileInputRef : folderInputRef
      setTimeout(() => ref.current?.focus(), 0)
    }
  }, [createMode])

  const tree = useMemo(() => buildTree(Object.keys(files)), [files])

  function toggleDir(path: string) {
    setExpanded((s) => ({ ...s, [path]: !s[path] }))
  }

  function promptNewFile(parent: string) {
    setCreateMode({ kind: 'file', parent })
    setCreateValue(parent ? `${parent}/` : '')
  }

  function promptNewFolder(parent: string) {
    setCreateMode({ kind: 'folder', parent })
    setCreateValue(parent ? `${parent}/` : '')
  }

  function handleConfirmCreate() {
    if (!createMode) return
    const val = createValue.trim()
    if (!val) {
      setCreateError('Path cannot be empty')
      return
    }
    if (createMode.kind === 'file') {
      if (files[val] !== undefined) {
        setCreateError('File already exists')
        return
      }
      addFile(val, '')
    } else {
      const folderPath = val.endsWith('/') ? val.slice(0, -1) : val
      const gitkeep = `${folderPath}/.gitkeep`
      if (files[gitkeep] !== undefined) {
        setCreateError('Folder already exists')
        return
      }
      addFile(gitkeep, '')
    }
    setCreateMode(null)
  }

  function confirmDelete(path: string, kind: 'file' | 'folder') {
    setDeleteTarget({ path, kind })
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return
    if (deleteTarget.kind === 'folder') {
      deleteFolder(deleteTarget.path)
    } else {
      deleteFile(deleteTarget.path)
    }
    setDeleteTarget(null)
  }

  function renderNodes(nodes: Node[], depth: number): React.ReactNode {
    return nodes.map((n) => {
      if (n.kind === 'dir') {
        const open = expanded[n.path] ?? false
        return (
          <div key={n.path}>
            <div
              className="group flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer hover:bg-gv-bg3 text-gv-fg2 text-[12px]"
              style={{ paddingLeft: 4 + depth * 12 }}
              onClick={() => toggleDir(n.path)}
            >
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="truncate">{n.name}</span>
              <span className="ch-row-actions ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-1.5">
                <button
                  className="ch-icon-btn hover:text-gv-accent"
                  title="New file"
                  onClick={(e) => { e.stopPropagation(); promptNewFile(n.path) }}
                >
                  <FilePlus size={12} />
                </button>
                <button
                  className="ch-icon-btn hover:text-gv-accent"
                  title="New folder"
                  onClick={(e) => { e.stopPropagation(); promptNewFolder(n.path) }}
                >
                  <FolderPlus size={12} />
                </button>
                <button
                  className="ch-icon-btn hover:text-gv-red"
                  title="Delete folder"
                  onClick={(e) => { e.stopPropagation(); confirmDelete(n.path, 'folder') }}
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
            {open && renderNodes(n.children, depth + 1)}
          </div>
        )
      }
      const isActive = n.path === activePath
      const accent = isValuesFile(n.path) ? 'text-gv-yellow' : 'text-gv-fg'
      return (
        <div
          key={n.path}
          className={clsx(
            'group flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer text-[12px]',
            isActive ? 'bg-gv-bg3' : 'hover:bg-gv-bg3',
            accent,
          )}
          style={{ paddingLeft: 4 + depth * 12 + 14 }}
          onClick={() => setActivePath(n.path)}
        >
          {iconForFile(n.name)}
          <span className="truncate">{n.name}</span>
          <button
            className="ch-row-actions ch-icon-btn ml-auto opacity-0 group-hover:opacity-100 hover:text-gv-red"
            title="Delete"
            onClick={(e) => { e.stopPropagation(); confirmDelete(n.path, 'file') }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      )
    })
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto py-1">
      <div className="flex items-center justify-between px-2 py-0.5 text-[10px] uppercase tracking-wider text-gv-dim">
        <span>files</span>
        <span className="flex items-center gap-1">
          <button className="ch-icon-btn hover:text-gv-accent" title="New file at root" onClick={() => promptNewFile('')}>
            <FilePlus size={12} />
          </button>
          <button className="ch-icon-btn hover:text-gv-accent" title="New folder at root" onClick={() => promptNewFolder('')}>
            <FolderPlus size={12} />
          </button>
        </span>
      </div>
      {renderNodes(tree, 0)}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget?.kind === 'folder' ? 'Delete folder?' : 'Delete file?'}
        icon={<Trash2 size={12} className="text-gv-red" />}
        width="sm"
        footer={
          <>
            <button className="hp-btn" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="hp-btn hp-btn-danger" onClick={handleConfirmDelete}>Delete</button>
          </>
        }
      >
        {deleteTarget && (
          <p className="text-gv-fg">
            {deleteTarget.kind === 'folder'
              ? <>This will permanently delete the folder <span className="text-gv-yellow font-bold">{deleteTarget.path}/</span> and all its contents.</>
              : <>This will permanently delete <span className="text-gv-yellow font-bold">{deleteTarget.path}</span>.</>
            }
          </p>
        )}
      </Modal>
      <Modal
        open={createMode?.kind === 'file'}
        onClose={() => setCreateMode(null)}
        title="New file"
        icon={<FilePlus size={12} className="text-gv-aqua" />}
        width="sm"
        footer={
          <>
            <button className="hp-btn" onClick={() => setCreateMode(null)}>Cancel</button>
            <button className="hp-btn hp-btn-primary" onClick={handleConfirmCreate}>Create</button>
          </>
        }
      >
        <label className="block text-gv-dim text-[10px] uppercase tracking-wider mb-1">File path</label>
        <input
          ref={fileInputRef}
          type="text"
          value={createValue}
          onChange={(e) => { setCreateValue(e.target.value); setCreateError('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmCreate() }}
          className="hp-input w-full"
        />
        {createError && <p className="mt-1.5 text-[11px] text-gv-red">{createError}</p>}
      </Modal>
      <Modal
        open={createMode?.kind === 'folder'}
        onClose={() => setCreateMode(null)}
        title="New folder"
        icon={<FolderPlus size={12} className="text-gv-aqua" />}
        width="sm"
        footer={
          <>
            <button className="hp-btn" onClick={() => setCreateMode(null)}>Cancel</button>
            <button className="hp-btn hp-btn-primary" onClick={handleConfirmCreate}>Create</button>
          </>
        }
      >
        <label className="block text-gv-dim text-[10px] uppercase tracking-wider mb-1">Folder name</label>
        <input
          ref={folderInputRef}
          type="text"
          value={createValue}
          onChange={(e) => { setCreateValue(e.target.value); setCreateError('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmCreate() }}
          className="hp-input w-full"
        />
        {createError && <p className="mt-1.5 text-[11px] text-gv-red">{createError}</p>}
      </Modal>
    </div>
  )
}
