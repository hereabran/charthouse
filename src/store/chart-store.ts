import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  CHART_YAML,
  VALUES_OVERRIDE_YAML,
  VALUES_YAML,
  type ChartFiles,
} from '@/types/chart'
import { SAMPLE_CHART } from '@/lib/sample-chart'

type ChartStore = {
  files: ChartFiles
  activePath: string
  releaseName: string
  namespace: string
  setActivePath: (p: string) => void
  setFile: (path: string, content: string) => void
  renameFile: (from: string, to: string) => void
  deleteFile: (path: string) => void
  addFile: (path: string, content?: string) => void
  replaceAll: (files: ChartFiles, opts?: { release?: string; namespace?: string }) => void
  setReleaseName: (name: string) => void
  setNamespace: (ns: string) => void
  resetToSample: () => void
}

export const useChartStore = create<ChartStore>()(
  persist(
    (set, get) => ({
      files: SAMPLE_CHART,
      activePath: 'templates/deployment.yaml',
      releaseName: 'demo',
      namespace: 'default',
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
      addFile: (path, content = '') =>
        set((s) => {
          if (path in s.files) return s
          return { files: { ...s.files, [path]: content }, activePath: path }
        }),
      replaceAll: (files, opts) =>
        set(() => {
          const paths = Object.keys(files).sort()
          const active =
            paths.find((p) => p.startsWith('templates/') && p.endsWith('.yaml')) ??
            paths[0] ??
            ''
          return {
            files,
            activePath: active,
            releaseName: opts?.release ?? get().releaseName,
            namespace: opts?.namespace ?? get().namespace,
          }
        }),
      setReleaseName: (name) => set({ releaseName: name }),
      setNamespace: (ns) => set({ namespace: ns }),
      resetToSample: () =>
        set({
          files: SAMPLE_CHART,
          activePath: 'templates/deployment.yaml',
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
