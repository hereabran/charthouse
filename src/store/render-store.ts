import { create } from 'zustand'

type RenderStore = {
  loading: boolean
  ok: boolean
  stdout: string
  stderr: string
  durationMs: number
  helmVersion?: string
  lastRenderedAt: number | null
  error: string | null
  setLoading: (l: boolean) => void
  setResult: (r: {
    ok: boolean
    stdout: string
    stderr: string
    durationMs: number
    helmVersion?: string
  }) => void
  setError: (e: string) => void
}

export const useRenderStore = create<RenderStore>((set) => ({
  loading: false,
  ok: true,
  stdout: '',
  stderr: '',
  durationMs: 0,
  helmVersion: undefined,
  lastRenderedAt: null,
  error: null,
  setLoading: (l) => set({ loading: l, error: null }),
  setResult: (r) =>
    set({
      ...r,
      loading: false,
      lastRenderedAt: Date.now(),
      error: null,
    }),
  setError: (e) => set({ loading: false, error: e }),
}))
