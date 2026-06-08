export type ChartFiles = Record<string, string>

export const CHART_YAML = 'Chart.yaml'
export const VALUES_YAML = 'values.yaml'
export const VALUES_OVERRIDE_YAML = 'values.override.yaml'
export const TEMPLATES_DIR = 'templates/'

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
}
