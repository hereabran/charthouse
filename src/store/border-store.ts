import { create } from 'zustand'

type BorderStore = {
  sharp: boolean
  toggle: () => void
}

const STORAGE_KEY = 'hp:border'

function readInitial(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(STORAGE_KEY) === 'sharp'
}

function applySharp(sharp: boolean) {
  document.documentElement.classList.toggle('sharp', sharp)
  localStorage.setItem(STORAGE_KEY, sharp ? 'sharp' : 'rounded')
}

export const useBorderStore = create<BorderStore>((set, get) => ({
  sharp: readInitial(),
  toggle: () => {
    const next = !get().sharp
    applySharp(next)
    set({ sharp: next })
  },
}))

if (typeof window !== 'undefined') {
  applySharp(useBorderStore.getState().sharp)
}
