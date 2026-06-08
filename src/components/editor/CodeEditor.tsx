import { useEffect, useMemo, useRef } from 'react'
import Editor, { type Monaco, type OnMount, loader } from '@monaco-editor/react'
import { useThemeStore } from '@/store/theme-store'
import type { editor } from 'monaco-editor'

// Pin to the same Monaco version the wrapper expects.
loader.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' } })

const ACCENT_HEX: Record<string, { dark: string; light: string }> = {
  'var(--gv-aqua)':   { dark: '8ec07c', light: '427b58' },
  'var(--gv-blue)':   { dark: '83a598', light: '076678' },
  'var(--gv-green)':  { dark: 'b8bb26', light: '79740e' },
  'var(--gv-yellow)': { dark: 'fabd2f', light: 'b57614' },
  'var(--gv-orange)': { dark: 'fe8019', light: 'af3a03' },
  'var(--gv-red)':    { dark: 'fb4934', light: '9d0006' },
  'var(--gv-purple)': { dark: 'd3869b', light: '8f3f71' },
}

function getAccentHex(accent: string, mode: 'dark' | 'light'): string {
  return ACCENT_HEX[accent]?.[mode] ?? ACCENT_HEX['var(--gv-aqua)'][mode]
}

function buildTheme(mode: 'dark' | 'light', accentHex: string): editor.IStandaloneThemeData {
  if (mode === 'dark') {
    return {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '928374', fontStyle: 'italic' },
        { token: 'string', foreground: 'b8bb26' },
        { token: 'number', foreground: accentHex },
        { token: 'keyword', foreground: accentHex },
        { token: 'type', foreground: 'fabd2f' },
        { token: 'delimiter', foreground: 'ebdbb2' },
        { token: 'attribute.name', foreground: 'fabd2f' },
        { token: 'attribute.value', foreground: 'b8bb26' },
      ] as never,
      colors: {
        'editor.background': '#1d2021',
        'editor.foreground': '#ebdbb2',
        'editor.lineHighlightBackground': '#282828',
        'editorLineNumber.foreground': '#504945',
        'editorLineNumber.activeForeground': accentHex,
        'editorCursor.foreground': accentHex,
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
    }
  }
  return {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '928374', fontStyle: 'italic' },
      { token: 'string', foreground: '79740e' },
      { token: 'number', foreground: accentHex },
      { token: 'keyword', foreground: accentHex },
      { token: 'type', foreground: 'b57614' },
      { token: 'delimiter', foreground: '3c3836' },
      { token: 'attribute.name', foreground: 'b57614' },
      { token: 'attribute.value', foreground: '79740e' },
    ] as never,
    colors: {
      'editor.background': '#f9f5d7',
      'editor.foreground': '#3c3836',
      'editor.lineHighlightBackground': '#f2e5bc',
      'editorLineNumber.foreground': '#bdae93',
      'editorLineNumber.activeForeground': accentHex,
      'editorCursor.foreground': accentHex,
      'editor.selectionBackground': '#ebdbb2',
      'editor.inactiveSelectionBackground': '#f2e5bc',
      'editorIndentGuide.background': '#ebdbb2',
      'editorIndentGuide.activeBackground': '#d5c4a1',
    },
  }
}

function languageFor(path: string): string {
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.tpl')) return 'handlebars'
  if (path.endsWith('.txt') || path === 'NOTES.txt') return 'handlebars'
  if (path.endsWith('.md')) return 'markdown'
  return 'plaintext'
}

type Props = {
  path: string
  value: string
  onChange: (v: string) => void
  readOnly?: boolean
  ariaLabel?: string
  markers?: editor.IMarkerData[]
}

export function CodeEditor({ path, value, onChange, readOnly, ariaLabel, markers }: Props) {
  const theme = useThemeStore((s) => s.theme)
  const accent = useThemeStore((s) => s.accent)
  const monacoRef = useRef<Monaco | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const markersRef = useRef<editor.IMarkerData[]>(markers ?? [])
  const language = useMemo(() => languageFor(path), [path])

  const accentHex = useMemo(() => getAccentHex(accent, theme), [accent, theme])

  function applyTheme() {
    const monaco = monacoRef.current
    if (!monaco) return
    const mode = theme === 'dark' ? 'dark' : 'light'
    monaco.editor.defineTheme(mode === 'dark' ? 'gruvbox-dark' : 'gruvbox-light', buildTheme(mode, accentHex))
    monaco.editor.setTheme(mode === 'dark' ? 'gruvbox-dark' : 'gruvbox-light')
  }

  function applyMarkers() {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    const model = editor.getModel()
    if (!model) return
    monaco.editor.setModelMarkers(model, 'schema-validation', markersRef.current)
  }

  const handleMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco
    editorRef.current = editor
    applyTheme()
    editor.onDidChangeModel(() => {
      applyMarkers()
    })
    applyMarkers()
  }

  useEffect(() => {
    applyTheme()
  }, [theme, accentHex])

  useEffect(() => {
    markersRef.current = markers ?? []
    applyMarkers()
  }, [markers])

  return (
    <Editor
      path={path}
      language={language}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
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
