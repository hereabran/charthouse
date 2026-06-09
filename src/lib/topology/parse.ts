import yaml from 'js-yaml'
import type { NodeGroup } from './types'

// A single Kubernetes resource parsed out of the rendered manifest stream.
export type ParsedResource = {
  id: string
  apiGroup: string
  kind: string
  name: string
  namespace: string
  group: NodeGroup
  docIndex: number
  source: string
  body: string
  raw: Record<string, unknown>
}

// Kinds that are not namespaced — their namespace is normalized to '' so that
// cross-namespace references (e.g. a ClusterRole) resolve correctly.
const CLUSTER_SCOPED = new Set([
  'Namespace',
  'Node',
  'PersistentVolume',
  'StorageClass',
  'ClusterRole',
  'ClusterRoleBinding',
  'CustomResourceDefinition',
  'IngressClass',
  'PriorityClass',
  'MutatingWebhookConfiguration',
  'ValidatingWebhookConfiguration',
  'APIService',
  'CSIDriver',
  'RuntimeClass',
])

const WORKLOADS = new Set([
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'ReplicationController',
  'Pod',
  'Job',
  'CronJob',
])
const NETWORKING = new Set([
  'Service',
  'Ingress',
  'IngressClass',
  'NetworkPolicy',
  'Endpoints',
  'EndpointSlice',
  'Gateway',
  'HTTPRoute',
])
const CONFIG = new Set(['ConfigMap', 'Secret'])
const RBAC = new Set([
  'ServiceAccount',
  'Role',
  'ClusterRole',
  'RoleBinding',
  'ClusterRoleBinding',
])
const STORAGE = new Set(['PersistentVolumeClaim', 'PersistentVolume', 'StorageClass'])
const AUTOSCALING = new Set([
  'HorizontalPodAutoscaler',
  'VerticalPodAutoscaler',
  'PodDisruptionBudget',
])

export function groupForKind(kind: string): NodeGroup {
  if (WORKLOADS.has(kind)) return 'workload'
  if (NETWORKING.has(kind)) return 'networking'
  if (CONFIG.has(kind)) return 'config'
  if (RBAC.has(kind)) return 'rbac'
  if (STORAGE.has(kind)) return 'storage'
  if (AUTOSCALING.has(kind)) return 'autoscaling'
  return 'other'
}

export function isClusterScoped(kind: string): boolean {
  return CLUSTER_SCOPED.has(kind)
}

// apiGroupOf returns the group portion of an apiVersion ('apps/v1' -> 'apps',
// 'v1' -> '', 'networking.k8s.io/v1' -> 'networking.k8s.io').
export function apiGroupOf(apiVersion: unknown): string {
  if (typeof apiVersion !== 'string' || apiVersion === '') return ''
  const idx = apiVersion.indexOf('/')
  return idx === -1 ? '' : apiVersion.slice(0, idx)
}

export function nodeId(apiGroup: string, kind: string, namespace: string, name: string): string {
  return `${apiGroup}|${kind}|${namespace}|${name}`
}

// splitManifestDocs splits rendered helm output into raw doc chunks, capturing
// the `# Source:` line. Mirrors the splitter in RenderedOutput so behavior is
// consistent between the YAML view and the graph.
export function splitManifestDocs(stdout: string): { source: string; body: string }[] {
  if (!stdout.trim()) return []
  const parts = stdout.split(/^---\s*$/m)
  const out: { source: string; body: string }[] = []
  for (const raw of parts) {
    const trimmed = raw.replace(/^\s*\n/, '')
    if (!trimmed.trim()) continue
    const sourceMatch = trimmed.match(/^#\s*Source:\s*(.+)$/m)
    out.push({ source: sourceMatch?.[1]?.trim() ?? '', body: trimmed })
  }
  return out
}

export function parseResources(stdout: string, defaultNamespace: string): ParsedResource[] {
  const docs = splitManifestDocs(stdout)
  const resources: ParsedResource[] = []

  docs.forEach((doc, docIndex) => {
    let loaded: unknown[]
    try {
      loaded = yaml.loadAll(doc.body) as unknown[]
    } catch {
      return // skip docs that don't parse — one bad doc never kills the graph
    }
    for (const obj of loaded) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue
      const rec = obj as Record<string, unknown>
      const kind = typeof rec.kind === 'string' ? rec.kind : ''
      const metadata =
        rec.metadata && typeof rec.metadata === 'object'
          ? (rec.metadata as Record<string, unknown>)
          : {}
      const name = typeof metadata.name === 'string' ? metadata.name : ''
      if (!kind || !name) continue

      const apiGroup = apiGroupOf(rec.apiVersion)
      const namespace = CLUSTER_SCOPED.has(kind)
        ? ''
        : typeof metadata.namespace === 'string' && metadata.namespace
          ? metadata.namespace
          : defaultNamespace

      resources.push({
        id: nodeId(apiGroup, kind, namespace, name),
        apiGroup,
        kind,
        name,
        namespace,
        group: groupForKind(kind),
        docIndex,
        source: doc.source,
        body: doc.body,
        raw: rec,
      })
    }
  })

  return resources
}
