import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, FolderUp, FileArchive } from 'lucide-react'
import { useChartStore } from '@/store/chart-store'
import { readArchive, readFolderInput, readZip, readTgz } from '@/lib/chart-archive'
import type { ChartFiles } from '@/types/chart'

// Augment <input> for directory-picker attributes that aren't in the standard typings.
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string
    directory?: string
  }
}

function announce(msg: string) {
  // Light-weight non-blocking notification via console + window event.
  // The window-level drop handler also surfaces errors.
  // eslint-disable-next-line no-console
  console.warn('[charthouse]', msg)
}

async function filesFromDropEntries(entries: FileSystemEntry[]): Promise<ChartFiles> {
  const out: ChartFiles = {}
  const all: { path: string; file: File }[] = []

  async function walk(entry: FileSystemEntry, base: string): Promise<void> {
    if (entry.isFile) {
      const file: File = await new Promise((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
      all.push({ path: base + file.name, file })
      return
    }
    if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader()
      const children: FileSystemEntry[] = await new Promise((res, rej) => {
        const collected: FileSystemEntry[] = []
        const readBatch = () =>
          dirReader.readEntries((batch) => {
            if (batch.length === 0) res(collected)
            else { collected.push(...batch); readBatch() }
          }, rej)
        readBatch()
      })
      for (const c of children) await walk(c, base + entry.name + '/')
    }
  }

  for (const e of entries) await walk(e, '')

  if (all.length === 0) return out

  // strip common top-level prefix
  const segs = all.map(({ path }) => path.split('/')[0])
  const first = segs[0]
  const allSame = segs.every((s) => s === first)
  const stripPrefix = allSame ? first + '/' : ''

  for (const { path, file } of all) {
    const rel = stripPrefix && path.startsWith(stripPrefix) ? path.slice(stripPrefix.length) : path
    if (!rel) continue
    out[rel] = await file.text()
  }
  return out
}

export function UploadButton() {
  const replaceAll = useChartStore((s) => s.replaceAll)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)

  const handleArchive = useCallback(
    async (file: File) => {
      try {
        const files = await readArchive(file)
        if (Object.keys(files).length === 0) throw new Error('archive contained no readable files')
        replaceAll(files)
      } catch (err) {
        window.alert(`Upload failed: ${(err as Error).message}`)
      }
    },
    [replaceAll],
  )

  const handleFolder = useCallback(
    async (input: HTMLInputElement) => {
      try {
        const files = await readFolderInput(input)
        if (Object.keys(files).length === 0) throw new Error('folder contained no readable files')
        replaceAll(files)
      } catch (err) {
        window.alert(`Upload failed: ${(err as Error).message}`)
      }
    },
    [replaceAll],
  )

  return (
    <>
      <div className="relative">
        <button className="hp-btn" onClick={() => setOpen((v) => !v)} title="Upload chart">
          <Upload size={12} />
          <span>upload</span>
        </button>
        {open && (
          <div
            className="absolute right-0 mt-1 z-20 w-56 rounded border border-gv-border bg-gv-bg2 shadow-lg p-1 text-xs"
            onMouseLeave={() => setOpen(false)}
          >
            <button
              className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-gv-bg3 text-gv-fg"
              onClick={() => { setOpen(false); folderInputRef.current?.click() }}
            >
              <FolderUp size={12} /> folder
            </button>
            <button
              className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-gv-bg3 text-gv-fg"
              onClick={() => { setOpen(false); fileInputRef.current?.click() }}
            >
              <FileArchive size={12} /> .zip / .tgz
            </button>
            <div className="px-2 py-1 text-[10px] text-gv-dim border-t border-gv-border mt-1">
              or drag &amp; drop anywhere
            </div>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.tgz,.tar.gz"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleArchive(f)
          e.target.value = ''
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) handleFolder(e.target)
          e.target.value = ''
        }}
      />
    </>
  )
}

/** Whole-window drag overlay + drop handler. Mount once at app root. */
export function DropOverlay() {
  const replaceAll = useChartStore((s) => s.replaceAll)
  const [active, setActive] = useState(false)
  const counter = useRef(0)

  useEffect(() => {
    function onEnter(e: DragEvent) {
      if (!e.dataTransfer?.types.includes('Files')) return
      counter.current += 1
      setActive(true)
    }
    function onLeave() {
      counter.current = Math.max(0, counter.current - 1)
      if (counter.current === 0) setActive(false)
    }
    function onOver(e: DragEvent) {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    async function onDrop(e: DragEvent) {
      e.preventDefault()
      counter.current = 0
      setActive(false)
      const items = Array.from(e.dataTransfer?.items ?? [])
      const entries = items
        .map((it) => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null))
        .filter((x): x is FileSystemEntry => !!x)

      try {
        // If the drop contains exactly one regular file that looks like an archive, parse it.
        const droppedFiles = Array.from(e.dataTransfer?.files ?? [])
        if (
          entries.length === 1 &&
          entries[0].isFile &&
          droppedFiles.length === 1 &&
          /\.(zip|tgz|tar\.gz)$/i.test(droppedFiles[0].name)
        ) {
          const name = droppedFiles[0].name.toLowerCase()
          const files = name.endsWith('.zip') ? await readZip(droppedFiles[0]) : await readTgz(droppedFiles[0])
          if (Object.keys(files).length === 0) throw new Error('archive contained no readable files')
          replaceAll(files)
          return
        }
        const files = await filesFromDropEntries(entries)
        if (Object.keys(files).length === 0) throw new Error('drop contained no readable files')
        replaceAll(files)
      } catch (err) {
        announce((err as Error).message)
        window.alert(`Drop failed: ${(err as Error).message}`)
      }
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [replaceAll])

  if (!active) return null
  return (
    <div className="fixed inset-0 z-50 bg-gv-bg/70 backdrop-blur-sm pointer-events-none flex items-center justify-center">
      <div className="border-2 border-dashed border-gv-accent rounded-lg p-12 text-center bg-gv-bg2/90">
        <Upload size={32} className="mx-auto mb-3 text-gv-accent" />
        <p className="text-gv-fg font-medium">Drop chart here</p>
        <p className="text-gv-dim text-xs mt-1">folder, .zip, or .tgz</p>
      </div>
    </div>
  )
}

