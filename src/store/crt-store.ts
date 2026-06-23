import { create } from 'zustand'

// Optional CRT "scanlines" overlay. Mirrors border-store: a single boolean that
// toggles an `html.crt` class; the actual effect lives in globals.css so it can
// be applied pre-paint from index.html (no flash).
type CrtStore = {
  crt: boolean
  toggle: () => void
}

const STORAGE_KEY = 'hp:crt'

function readInitial(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(STORAGE_KEY) === 'crt'
}

function applyCrt(crt: boolean) {
  document.documentElement.classList.toggle('crt', crt)
  localStorage.setItem(STORAGE_KEY, crt ? 'crt' : 'off')
}

export const useCrtStore = create<CrtStore>((set, get) => ({
  crt: readInitial(),
  toggle: () => {
    const next = !get().crt
    applyCrt(next)
    set({ crt: next })
  },
}))

if (typeof window !== 'undefined') {
  applyCrt(useCrtStore.getState().crt)
}
