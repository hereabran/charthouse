import JSZip from 'jszip'
import pako from 'pako'
import type { ChartFiles } from '@/types/chart'

// Binary-ish extensions we should skip rather than corrupt by decoding as UTF-8.
const SKIP_BINARY_EXT = /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|tgz|tar\.gz|bin|wasm)$/i

// Always strip the leading top-level chart directory so paths look like
// "Chart.yaml" / "templates/foo.yaml" instead of "mychart/Chart.yaml".
function stripChartRoot(paths: string[]): (p: string) => string {
  const segments = paths
    .filter((p) => p && !p.endsWith('/'))
    .map((p) => p.split('/')[0])
  if (segments.length === 0) return (p) => p
  const first = segments[0]
  const allSame = segments.every((s) => s === first)
  if (!allSame) return (p) => p
  const prefix = first + '/'
  return (p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p)
}

export async function readZip(file: File | Blob): Promise<ChartFiles> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const files: ChartFiles = {}
  const paths = Object.keys(zip.files).filter((p) => !zip.files[p].dir)
  const strip = stripChartRoot(paths)
  for (const p of paths) {
    if (SKIP_BINARY_EXT.test(p)) continue
    const content = await zip.files[p].async('string')
    const stripped = strip(p)
    if (!stripped) continue
    files[stripped] = content
  }
  return files
}

/**
 * Minimal POSIX tar reader (handles ustar + GNU "L" longname/longlink).
 * Tar is a sequence of 512-byte header blocks followed by file data padded to 512.
 * Spec: https://www.gnu.org/software/tar/manual/html_node/Standard.html
 */
function parseTar(data: Uint8Array): Array<{ name: string; content: Uint8Array; type: string }> {
  const out: Array<{ name: string; content: Uint8Array; type: string }> = []
  const decoder = new TextDecoder('utf-8')
  let offset = 0
  let pendingLongName: string | null = null

  while (offset + 512 <= data.byteLength) {
    const header = data.subarray(offset, offset + 512)
    // End-of-archive: two consecutive zero blocks
    if (header.every((b) => b === 0)) {
      offset += 512
      continue
    }

    const readStr = (start: number, len: number) => {
      const slice = header.subarray(start, start + len)
      const end = slice.indexOf(0)
      return decoder.decode(end === -1 ? slice : slice.subarray(0, end))
    }
    const readOctal = (start: number, len: number) => {
      const s = readStr(start, len).trim()
      return s ? parseInt(s, 8) : 0
    }

    let name = readStr(0, 100)
    const size = readOctal(124, 12)
    const type = readStr(156, 1) || '0'
    const prefix = readStr(345, 155)
    if (prefix) name = `${prefix}/${name}`
    if (pendingLongName) {
      name = pendingLongName
      pendingLongName = null
    }

    offset += 512
    const dataStart = offset
    const blocks = Math.ceil(size / 512)
    offset += blocks * 512

    if (type === 'L') {
      // GNU long name extension — data is the next entry's actual name.
      pendingLongName = decoder.decode(data.subarray(dataStart, dataStart + size)).replace(/\0+$/, '')
      continue
    }
    if (type === '0' || type === '' || type === '7') {
      out.push({ name, content: data.subarray(dataStart, dataStart + size), type })
    }
    // ignore directories (5), symlinks (1/2), pax headers (x/g), etc.
  }
  return out
}

export async function readTgz(file: File | Blob): Promise<ChartFiles> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const tar = pako.inflate(buf)
  const entries = parseTar(tar)
  const decoder = new TextDecoder('utf-8')

  const seenPaths = entries.map((e) => e.name)
  const strip = stripChartRoot(seenPaths)
  const out: ChartFiles = {}
  for (const e of entries) {
    if (SKIP_BINARY_EXT.test(e.name)) continue
    const stripped = strip(e.name)
    if (!stripped) continue
    out[stripped] = decoder.decode(e.content)
  }
  return out
}

export async function readFolderInput(input: HTMLInputElement): Promise<ChartFiles> {
  const out: ChartFiles = {}
  const items = Array.from(input.files ?? [])
  if (items.length === 0) return out
  const paths = items.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name)
  const strip = stripChartRoot(paths)
  for (const f of items) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    if (SKIP_BINARY_EXT.test(rel)) continue
    const stripped = strip(rel)
    if (!stripped) continue
    out[stripped] = await f.text()
  }
  return out
}

export async function readArchive(file: File): Promise<ChartFiles> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.zip')) return readZip(file)
  if (name.endsWith('.tgz') || name.endsWith('.tar.gz')) return readTgz(file)
  throw new Error(`Unsupported archive: ${file.name}. Use .zip, .tgz, or .tar.gz.`)
}
