import { create } from 'zustand'

type Theme = 'dark' | 'light'

export const ACCENT_COLORS = [
  { name: 'aqua',   value: 'var(--gv-aqua)' },
  { name: 'blue',   value: 'var(--gv-blue)' },
  { name: 'green',  value: 'var(--gv-green)' },
  { name: 'yellow', value: 'var(--gv-yellow)' },
  { name: 'orange', value: 'var(--gv-orange)' },
  { name: 'red',    value: 'var(--gv-red)' },
  { name: 'purple', value: 'var(--gv-purple)' },
] as const

type ThemeStore = {
  theme: Theme
  accent: string
  setTheme: (t: Theme) => void
  toggle: () => void
  setAccent: (c: string) => void
}

const THEME_KEY = 'hp:theme'
const ACCENT_KEY = 'hp:accent'

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = localStorage.getItem(THEME_KEY) as Theme | null
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readInitialAccent(): string {
  if (typeof window === 'undefined') return ACCENT_COLORS[0].value
  return localStorage.getItem(ACCENT_KEY) || ACCENT_COLORS[0].value
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
  localStorage.setItem(THEME_KEY, t)
}

function applyAccent(c: string) {
  document.documentElement.style.setProperty('--gv-accent', c)
  localStorage.setItem(ACCENT_KEY, c)
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: readInitialTheme(),
  accent: readInitialAccent(),
  setTheme: (t) => {
    applyTheme(t)
    set({ theme: t })
  },
  toggle: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    set({ theme: next })
  },
  setAccent: (c) => {
    applyAccent(c)
    set({ accent: c })
  },
}))

// Sync DOM with initial state on module load.
if (typeof window !== 'undefined') {
  applyTheme(useThemeStore.getState().theme)
  applyAccent(useThemeStore.getState().accent)
}
