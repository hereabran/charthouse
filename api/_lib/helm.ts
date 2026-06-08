import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export type RunResult = {
  ok: boolean
  stdout: string
  stderr: string
  durationMs: number
}

const HELM_BIN = process.env.HELM_BIN || 'helm'
const MAX_FILES = 500
const MAX_FILE_BYTES = 256 * 1024
const MAX_TOTAL_BYTES = 4 * 1024 * 1024
const RENDER_TIMEOUT_MS = 10_000

function isSafeRelPath(p: string): boolean {
  if (!p) return false
  if (p.startsWith('/')) return false
  if (p.includes('\0')) return false
  const norm = path.posix.normalize(p)
  if (norm.startsWith('..') || norm.includes('/../') || norm === '.') return false
  return norm === p
}

export class RenderInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RenderInputError'
  }
}

export async function helmVersion(): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(HELM_BIN, ['version', '--short'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (b) => (out += b.toString()))
    child.on('error', () => resolve(''))
    child.on('close', () => resolve(out.trim()))
  })
}

export type RenderInput = {
  files: Record<string, string>
  releaseName: string
  namespace: string
  includeCRDs?: boolean
}

export async function runHelmTemplate(input: RenderInput): Promise<RunResult & { helmVersion: string }> {
  const started = Date.now()

  // Validate input shape.
  const paths = Object.keys(input.files)
  if (paths.length === 0) throw new RenderInputError('no chart files supplied')
  if (paths.length > MAX_FILES) throw new RenderInputError(`too many files (${paths.length} > ${MAX_FILES})`)

  let total = 0
  for (const p of paths) {
    if (!isSafeRelPath(p)) throw new RenderInputError(`unsafe path: ${p}`)
    const c = input.files[p]
    if (typeof c !== 'string') throw new RenderInputError(`file content must be string: ${p}`)
    if (c.length > MAX_FILE_BYTES) throw new RenderInputError(`file too large: ${p}`)
    total += c.length
  }
  if (total > MAX_TOTAL_BYTES) throw new RenderInputError(`total chart too large: ${total} bytes`)

  if (!input.files['Chart.yaml']) {
    throw new RenderInputError('Chart.yaml is required')
  }

  const release = (input.releaseName || 'demo').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 53) || 'demo'
  const namespace = (input.namespace || 'default').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 63) || 'default'

  const root = await mkdtemp(path.join(tmpdir(), 'helm-pg-'))
  const chartDir = path.join(root, 'chart')
  await mkdir(chartDir, { recursive: true })

  try {
    for (const rel of paths) {
      const abs = path.join(chartDir, rel)
      await mkdir(path.dirname(abs), { recursive: true })
      await writeFile(abs, input.files[rel], 'utf8')
    }

    const args = [
      'template',
      release,
      chartDir,
      '--namespace', namespace,
    ]
    // Helm will pick up values.yaml at the chart root automatically.
    // Pass values.override.yaml explicitly with -f if present.
    if (input.files['values.override.yaml']) {
      args.push('-f', path.join(chartDir, 'values.override.yaml'))
    }
    if (input.includeCRDs) args.push('--include-crds')

    const result = await new Promise<RunResult>((resolve) => {
      const child = spawn(HELM_BIN, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HELM_CACHE_HOME: path.join(root, 'cache'), HELM_CONFIG_HOME: path.join(root, 'config'), HELM_DATA_HOME: path.join(root, 'data') },
      })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        stderr += `\nrender timed out after ${RENDER_TIMEOUT_MS}ms`
      }, RENDER_TIMEOUT_MS)
      child.stdout.on('data', (b) => (stdout += b.toString()))
      child.stderr.on('data', (b) => (stderr += b.toString()))
      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({ ok: false, stdout: '', stderr: `failed to spawn ${HELM_BIN}: ${err.message}`, durationMs: Date.now() - started })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ ok: code === 0, stdout, stderr, durationMs: Date.now() - started })
      })
    })

    const version = await helmVersion()
    return { ...result, helmVersion: version }
  } finally {
    rm(root, { recursive: true, force: true }).catch(() => {})
  }
}
