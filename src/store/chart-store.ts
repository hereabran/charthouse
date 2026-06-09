import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  CHART_YAML,
  SINGLE_TEMPLATE_PATH,
  VALUES_OVERRIDE_YAML,
  VALUES_YAML,
  type ChartFiles,
  type ChartMode,
} from '@/types/chart'
import { SAMPLE_CHART, SAMPLE_SINGLE_TEMPLATE } from '@/lib/sample-chart'

type ReplaceOpts = {
  release?: string
  namespace?: string
  mode?: ChartMode
  single?: { template: string }
}

type ChartStore = {
  files: ChartFiles
  activePath: string
  releaseName: string
  namespace: string
  mode: ChartMode
  // Single-template mode owns only its scratch template. Values (values.yaml /
  // values.override.yaml) are SHARED with chart mode via `files`, so switching
  // modes never overwrites or loses your values.
  singleTemplate: string
  setActivePath: (p: string) => void
  setFile: (path: string, content: string) => void
  renameFile: (from: string, to: string) => void
  deleteFile: (path: string) => void
  deleteFolder: (prefix: string) => void
  addFile: (path: string, content?: string) => void
  replaceAll: (files: ChartFiles, opts?: ReplaceOpts) => void
  setReleaseName: (name: string) => void
  setNamespace: (ns: string) => void
  setMode: (mode: ChartMode) => void
  setSingleTemplate: (s: string) => void
  resetToSample: () => void
}

export const useChartStore = create<ChartStore>()(
  persist(
    (set) => ({
      files: SAMPLE_CHART,
      activePath: 'templates/deployment.yaml',
      releaseName: 'demo',
      namespace: 'default',
      mode: 'chart',
      singleTemplate: SAMPLE_SINGLE_TEMPLATE,
      setActivePath: (p) => set({ activePath: p }),
      setFile: (path, content) =>
        set((s) => ({ files: { ...s.files, [path]: content } })),
      renameFile: (from, to) =>
        set((s) => {
          if (from === to || !s.files[from]) return s
          const { [from]: content, ...rest } = s.files
          return {
            files: { ...rest, [to]: content },
            activePath: s.activePath === from ? to : s.activePath,
          }
        }),
      deleteFile: (path) =>
        set((s) => {
          if (!(path in s.files)) return s
          const { [path]: _, ...rest } = s.files
          void _
          const remaining = Object.keys(rest).sort()
          return {
            files: rest,
            activePath: s.activePath === path ? remaining[0] ?? '' : s.activePath,
          }
        }),
      deleteFolder: (prefix) =>
        set((s) => {
          const dirPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`
          const remaining: ChartFiles = {}
          for (const [k, v] of Object.entries(s.files)) {
            if (!k.startsWith(dirPrefix)) remaining[k] = v
          }
          const remainingKeys = Object.keys(remaining).sort()
          const activeStillExists = s.activePath in remaining
          return {
            files: remaining,
            activePath: activeStillExists ? s.activePath : remainingKeys[0] ?? '',
          }
        }),
      addFile: (path, content = '') =>
        set((s) => {
          if (path in s.files) return s
          return { files: { ...s.files, [path]: content }, activePath: path }
        }),
      replaceAll: (files, opts) =>
        set((s) => {
          const paths = Object.keys(files).sort()
          const active =
            paths.find((p) => p.startsWith('templates/') && p.endsWith('.yaml')) ??
            paths[0] ??
            ''
          return {
            files,
            activePath: active,
            releaseName: opts?.release ?? s.releaseName,
            namespace: opts?.namespace ?? s.namespace,
            mode: opts?.mode ?? s.mode,
            ...(opts?.single ? { singleTemplate: opts.single.template } : {}),
          }
        }),
      setReleaseName: (name) => set({ releaseName: name }),
      setNamespace: (ns) => set({ namespace: ns }),
      setMode: (mode) => set({ mode }),
      setSingleTemplate: (s) => set({ singleTemplate: s }),
      resetToSample: () =>
        set({
          files: SAMPLE_CHART,
          activePath: 'templates/deployment.yaml',
          singleTemplate: SAMPLE_SINGLE_TEMPLATE,
        }),
    }),
    { name: 'hp:chart' },
  ),
)

export function isValuesFile(path: string): boolean {
  return path === VALUES_YAML || path === VALUES_OVERRIDE_YAML
}

export function isChartYaml(path: string): boolean {
  return path === CHART_YAML
}

type RenderInputs = Pick<ChartStore, 'mode' | 'files' | 'singleTemplate'>

// buildRenderFiles produces the file map sent to /api/render. Chart mode passes
// files through unchanged. Single mode wraps the scratch template in a minimal
// synthesized chart, reusing the SHARED values.yaml / values.override.yaml from
// `files` so the values you see are the values that render in both modes.
export function buildRenderFiles(s: RenderInputs): ChartFiles {
  if (s.mode === 'chart') return s.files
  const out: ChartFiles = {
    [CHART_YAML]: 'apiVersion: v2\nname: chart\nversion: 0.1.0\n',
    [SINGLE_TEMPLATE_PATH]: s.singleTemplate,
    [VALUES_YAML]: s.files[VALUES_YAML] ?? '',
  }
  const override = s.files[VALUES_OVERRIDE_YAML]
  if (override != null && override.trim() !== '') {
    out[VALUES_OVERRIDE_YAML] = override
  }
  return out
}
