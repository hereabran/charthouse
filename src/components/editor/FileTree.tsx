import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, File, FilePlus, FolderPlus, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useChartStore, isValuesFile } from '@/store/chart-store'

type Node =
  | { kind: 'dir'; name: string; path: string; children: Node[] }
  | { kind: 'file'; name: string; path: string }

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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ templates: true })

  const tree = useMemo(() => buildTree(Object.keys(files)), [files])

  function toggleDir(path: string) {
    setExpanded((s) => ({ ...s, [path]: !s[path] }))
  }

  function promptNewFile(parent: string) {
    const suggested = parent ? `${parent}/new.yaml` : 'new.yaml'
    const name = window.prompt('New file path:', suggested)
    if (!name) return
    if (files[name] !== undefined) {
      window.alert('File already exists')
      return
    }
    addFile(name, '')
  }

  function promptNewFolder(parent: string) {
    const suggested = parent ? `${parent}/new-folder/.gitkeep` : 'new-folder/.gitkeep'
    const name = window.prompt('New file path (folder is created from path):', suggested)
    if (!name) return
    addFile(name, '')
  }

  function confirmDelete(path: string) {
    if (window.confirm(`Delete ${path}?`)) deleteFile(path)
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
              <span className="ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-1">
                <button
                  className="hover:text-gv-accent"
                  title="New file"
                  onClick={(e) => { e.stopPropagation(); promptNewFile(n.path) }}
                >
                  <FilePlus size={12} />
                </button>
                <button
                  className="hover:text-gv-accent"
                  title="New folder"
                  onClick={(e) => { e.stopPropagation(); promptNewFolder(n.path) }}
                >
                  <FolderPlus size={12} />
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
          <File size={12} className="opacity-70 shrink-0" />
          <span className="truncate">{n.name}</span>
          <button
            className="ml-auto opacity-0 group-hover:opacity-100 hover:text-gv-red"
            title="Delete"
            onClick={(e) => { e.stopPropagation(); confirmDelete(n.path) }}
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
          <button className="hover:text-gv-accent" title="New file at root" onClick={() => promptNewFile('')}>
            <FilePlus size={12} />
          </button>
          <button className="hover:text-gv-accent" title="New folder at root" onClick={() => promptNewFolder('')}>
            <FolderPlus size={12} />
          </button>
        </span>
      </div>
      {renderNodes(tree, 0)}
    </div>
  )
}
