import { useEffect, useMemo, useRef } from 'react'
import Editor, { type Monaco, type OnMount, loader } from '@monaco-editor/react'
import { useThemeStore } from '@/store/theme-store'

// Pin to the same Monaco version the wrapper expects.
loader.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' } })

const GRUVBOX_DARK_RULES: Monaco['editor']['IStandaloneThemeData']['rules'] = [
  { token: 'comment', foreground: '928374', fontStyle: 'italic' },
  { token: 'string', foreground: 'b8bb26' },
  { token: 'number', foreground: 'd3869b' },
  { token: 'keyword', foreground: 'fb4934' },
  { token: 'type', foreground: 'fabd2f' },
  { token: 'delimiter', foreground: 'ebdbb2' },
  { token: 'tag', foreground: '8ec07c' },
  { token: 'attribute.name', foreground: 'fabd2f' },
  { token: 'attribute.value', foreground: 'b8bb26' },
] as never

const GRUVBOX_LIGHT_RULES = [
  { token: 'comment', foreground: '928374', fontStyle: 'italic' },
  { token: 'string', foreground: '79740e' },
  { token: 'number', foreground: '8f3f71' },
  { token: 'keyword', foreground: '9d0006' },
  { token: 'type', foreground: 'b57614' },
  { token: 'delimiter', foreground: '3c3836' },
  { token: 'tag', foreground: '427b58' },
  { token: 'attribute.name', foreground: 'b57614' },
  { token: 'attribute.value', foreground: '79740e' },
] as never

function languageFor(path: string): string {
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.tpl')) return 'plaintext' // mixed go-template + yaml; plaintext is safe
  if (path.endsWith('.txt')) return 'plaintext'
  if (path === 'NOTES.txt') return 'plaintext'
  return 'plaintext'
}

type Props = {
  path: string
  value: string
  onChange: (v: string) => void
  readOnly?: boolean
  ariaLabel?: string
}

export function CodeEditor({ path, value, onChange, readOnly, ariaLabel }: Props) {
  const theme = useThemeStore((s) => s.theme)
  const monacoRef = useRef<Monaco | null>(null)
  const language = useMemo(() => languageFor(path), [path])

  const handleMount: OnMount = (_editor, monaco) => {
    monacoRef.current = monaco
    monaco.editor.defineTheme('gruvbox-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: GRUVBOX_DARK_RULES,
      colors: {
        'editor.background': '#1d2021',
        'editor.foreground': '#ebdbb2',
        'editor.lineHighlightBackground': '#282828',
        'editorLineNumber.foreground': '#504945',
        'editorLineNumber.activeForeground': '#d5c4a1',
        'editorCursor.foreground': '#fabd2f',
        'editor.selectionBackground': '#3c3836',
        'editor.inactiveSelectionBackground': '#32302f',
        'editorIndentGuide.background': '#32302f',
        'editorIndentGuide.activeBackground': '#504945',
        'editorWhitespace.foreground': '#3c3836',
        'editorWidget.background': '#282828',
        'editorWidget.border': '#3c3836',
        'editorSuggestWidget.background': '#282828',
        'editorSuggestWidget.border': '#3c3836',
      },
    })
    monaco.editor.defineTheme('gruvbox-light', {
      base: 'vs',
      inherit: true,
      rules: GRUVBOX_LIGHT_RULES,
      colors: {
        'editor.background': '#f9f5d7',
        'editor.foreground': '#3c3836',
        'editor.lineHighlightBackground': '#f2e5bc',
        'editorLineNumber.foreground': '#bdae93',
        'editorLineNumber.activeForeground': '#7c6f64',
        'editorCursor.foreground': '#b57614',
        'editor.selectionBackground': '#ebdbb2',
        'editor.inactiveSelectionBackground': '#f2e5bc',
        'editorIndentGuide.background': '#ebdbb2',
        'editorIndentGuide.activeBackground': '#d5c4a1',
      },
    })
    monaco.editor.setTheme(theme === 'dark' ? 'gruvbox-dark' : 'gruvbox-light')
  }

  useEffect(() => {
    monacoRef.current?.editor.setTheme(theme === 'dark' ? 'gruvbox-dark' : 'gruvbox-light')
  }, [theme])

  return (
    <Editor
      path={path}
      language={language}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      theme={theme === 'dark' ? 'gruvbox-dark' : 'gruvbox-light'}
      options={{
        readOnly,
        ariaLabel,
        fontFamily: 'JetBrains Mono, Fira Code, ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        smoothScrolling: true,
        renderLineHighlight: 'all',
        tabSize: 2,
        automaticLayout: true,
        scrollbar: { useShadows: false, verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        padding: { top: 8, bottom: 8 },
      }}
    />
  )
}
