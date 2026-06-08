import { Moon, Sun } from 'lucide-react'
import { useThemeStore } from '@/store/theme-store'

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme)
  const toggle = useThemeStore((s) => s.toggle)
  return (
    <button
      className="hp-btn"
      onClick={toggle}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
      <span>{theme === 'dark' ? 'light' : 'dark'}</span>
    </button>
  )
}
