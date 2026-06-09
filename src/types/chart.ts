export type ChartFiles = Record<string, string>

export const CHART_YAML = 'Chart.yaml'
export const VALUES_YAML = 'values.yaml'
export const VALUES_OVERRIDE_YAML = 'values.override.yaml'
export const TEMPLATES_DIR = 'templates/'

/** Editing modes: a full chart (file tree) or a single template file. */
export type ChartMode = 'chart' | 'single'

/** Where the single-template-mode file is placed inside the synthesized chart. */
export const SINGLE_TEMPLATE_PATH = 'templates/template.yaml'

export type RenderRequest = {
  files: ChartFiles
  releaseName: string
  namespace: string
  includeCRDs?: boolean
}

export type RenderResponse = {
  ok: boolean
  stdout: string
  stderr: string
  durationMs: number
  helmVersion?: string
}

export type SharePayload = {
  files: ChartFiles
  releaseName: string
  namespace: string
  /** Absent on legacy shares — treated as 'chart'. */
  mode?: ChartMode
  /** Present when mode === 'single': the scratch template. Values travel in `files`. */
  single?: {
    template: string
  }
}
