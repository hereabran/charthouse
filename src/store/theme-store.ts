import { create } from 'zustand'

type Theme = 'dark' | 'light'

type ThemeStore = {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

const STORAGE_KEY = 'hp:theme'

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
  localStorage.setItem(STORAGE_KEY, t)
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: readInitial(),
  setTheme: (t) => {
    applyTheme(t)
    set({ theme: t })
  },
  toggle: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    set({ theme: next })
  },
}))

// Sync DOM class with initial state on module load.
if (typeof window !== 'undefined') {
  applyTheme(useThemeStore.getState().theme)
}
