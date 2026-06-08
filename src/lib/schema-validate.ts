import Ajv from 'ajv'
import type { ErrorObject } from 'ajv'
import * as yaml from 'js-yaml'
import type { editor } from 'monaco-editor'

let ajv: Ajv | null = null

function getAjv(): Ajv {
  if (!ajv) ajv = new Ajv({ allErrors: true, verbose: true, validateSchema: false })
  return ajv
}

function buildLineMap(yamlText: string): Map<string, number> {
  const lines = yamlText.split('\n')
  const map = new Map<string, number>()
  const stack: { indent: number; key: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trimStart()
    if (!trimmed || trimmed.startsWith('#')) continue

    const indent = line.length - line.trimStart().length
    const match = trimmed.match(/^(['"]?[\w.-]+['"]?)\s*:/)
    if (!match) continue

    let key = match[1].replace(/['"]/g, '')
    if (key.endsWith('.')) key = key.slice(0, -1)

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    const parts = stack.map((s) => s.key).concat(key)
    map.set('/' + parts.join('/'), i + 1)
    stack.push({ indent, key })
  }

  return map
}

function findLineForPath(lineMap: Map<string, number>, path: string): number {
  if (lineMap.has(path)) return lineMap.get(path)!

  const parts = path.split('/').filter(Boolean)
  for (let len = parts.length; len > 0; len--) {
    const partial = '/' + parts.slice(0, len).join('/')
    if (lineMap.has(partial)) return lineMap.get(partial)!
  }

  return 1
}

function formatMessage(error: ErrorObject): string {
  const path = error.instancePath.replace(/^\//, '').replace(/\//g, '.')
  const label = path || '(root)'

  switch (error.keyword) {
    case 'type':
      return `${label}: must be ${error.params.type}`
    case 'enum':
      return `${label}: must be one of: ${(error.params as { allowedValues: string[] }).allowedValues.join(', ')}`
    case 'required':
      return `missing required property: ${(error.params as { missingProperty: string }).missingProperty}`
    case 'additionalProperties':
      return `${label}: unknown property "${(error.params as { additionalProperty: string }).additionalProperty}"`
    case 'minimum':
      return `${label}: must be >= ${error.params.limit}`
    case 'maximum':
      return `${label}: must be <= ${error.params.limit}`
    case 'minLength':
      return `${label}: must have length >= ${error.params.limit}`
    case 'maxLength':
      return `${label}: must have length <= ${error.params.limit}`
    case 'pattern':
      return `${label}: must match pattern ${error.params.pattern}`
    case 'format':
      return `${label}: must be ${error.params.format} format`
    case 'const':
      return `${label}: must be ${JSON.stringify(error.params.value)}`
    case 'not':
      return `${label}: must not be ${error.schema}`
    case 'oneOf':
      return `${label}: must match exactly one of the given schemas`
    case 'anyOf':
      return `${label}: must match any of the given schemas`
    case 'allOf':
      return `${label}: must match all of the given schemas`
    case 'if':
      return `${label}: must match if schema`
    case 'properties':
    case 'items':
    case 'additionalItems':
      return error.message ?? `${label}: ${error.keyword} error`
    default:
      return error.message ? `${label}: ${error.message}` : `${label}: ${error.keyword} error`
  }
}

export function validateValues(
  schemaJson: string,
  valuesYaml: string,
): editor.IMarkerData[] {
  if (!valuesYaml.trim()) return []

  let schema: Record<string, unknown>
  try {
    schema = JSON.parse(schemaJson)
  } catch {
    console.warn('[schema-validate] Failed to parse schema JSON')
    return []
  }

  let values: unknown
  try {
    values = yaml.load(valuesYaml)
  } catch (e) {
    console.warn('[schema-validate] Failed to parse values YAML:', e)
    return []
  }

  if (!values || typeof values !== 'object') return []

  let validate: ReturnType<Ajv['compile']>
  try {
    const { $schema: _, ...schemaWithoutMeta } = schema
    validate = getAjv().compile(schemaWithoutMeta)
  } catch (e) {
    console.warn('[schema-validate] Failed to compile schema:', e)
    return []
  }

  validate(values)

  if (!validate.errors || validate.errors.length === 0) return []

  const lineMap = buildLineMap(valuesYaml)

  return validate.errors
    .map((error) => {
      const line = findLineForPath(lineMap, error.instancePath)
      return {
        severity: 2, // Warning
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: Number.MAX_SAFE_INTEGER,
        message: formatMessage(error),
        source: 'schema',
      }
    })
}
