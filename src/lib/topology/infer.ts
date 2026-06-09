import { groupForKind, isClusterScoped, nodeId, parseResources, type ParsedResource } from './parse'
import type { EdgeType, TopologyEdge, TopologyGraph, TopologyNode } from './types'

// ---- small safe accessors over untyped parsed YAML --------------------------

function asObj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function asStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}
// get walks a path of object keys, returning undefined on any miss.
function get(root: unknown, ...path: string[]): unknown {
  let cur: unknown = root
  for (const key of path) {
    const o = asObj(cur)
    if (!o) return undefined
    cur = o[key]
  }
  return cur
}
function strMap(v: unknown): Record<string, string> {
  const o = asObj(v)
  const out: Record<string, string> = {}
  if (!o) return out
  for (const [k, val] of Object.entries(o)) if (typeof val === 'string') out[k] = val
  return out
}

// ---- pod template extraction (varies by workload kind) ----------------------

function podSpec(r: ParsedResource): Record<string, unknown> | undefined {
  switch (r.kind) {
    case 'CronJob':
      return asObj(get(r.raw, 'spec', 'jobTemplate', 'spec', 'template', 'spec'))
    case 'Pod':
      return asObj(get(r.raw, 'spec'))
    default:
      return asObj(get(r.raw, 'spec', 'template', 'spec'))
  }
}
function podLabels(r: ParsedResource): Record<string, string> {
  switch (r.kind) {
    case 'CronJob':
      return strMap(get(r.raw, 'spec', 'jobTemplate', 'spec', 'template', 'metadata', 'labels'))
    case 'Pod':
      return strMap(get(r.raw, 'metadata', 'labels'))
    default:
      return strMap(get(r.raw, 'spec', 'template', 'metadata', 'labels'))
  }
}

// ---- selector matching ------------------------------------------------------

// Plain map selector (Service.spec.selector): every entry must match.
function mapSelectorMatches(selector: Record<string, string>, labels: Record<string, string>): boolean {
  const keys = Object.keys(selector)
  if (keys.length === 0) return false
  return keys.every((k) => labels[k] === selector[k])
}

type MatchExpr = { key: string; operator: string; values: string[] }

// LabelSelector (matchLabels + matchExpressions), used by PDB / NetworkPolicy.
function labelSelectorMatches(sel: unknown, labels: Record<string, string>): boolean {
  const o = asObj(sel)
  if (!o) return false
  const matchLabels = strMap(o.matchLabels)
  const exprs: MatchExpr[] = []
  for (const e of asArr(o.matchExpressions)) {
    const eo = asObj(e)
    if (!eo) continue
    exprs.push({
      key: asStr(eo.key) ?? '',
      operator: asStr(eo.operator) ?? '',
      values: asArr(eo.values).filter((x): x is string => typeof x === 'string'),
    })
  }
  const hasML = Object.keys(matchLabels).length > 0
  const hasME = exprs.length > 0
  if (!hasML && !hasME) return false // empty selector handled by caller
  if (hasML && !mapSelectorMatches(matchLabels, labels)) return false
  for (const e of exprs) {
    const has = e.key in labels
    const val = labels[e.key]
    const ok =
      e.operator === 'In'
        ? has && e.values.includes(val)
        : e.operator === 'NotIn'
          ? !has || !e.values.includes(val)
          : e.operator === 'Exists'
            ? has
            : e.operator === 'DoesNotExist'
              ? !has
              : false
    if (!ok) return false
  }
  return true
}

// labelSelectorIsEmpty reports whether a LabelSelector selects everything
// (NetworkPolicy podSelector: {} legitimately means "all pods in namespace").
function labelSelectorIsEmpty(sel: unknown): boolean {
  const o = asObj(sel)
  if (!o) return true
  return Object.keys(strMap(o.matchLabels)).length === 0 && asArr(o.matchExpressions).length === 0
}

// ---- graph assembly ---------------------------------------------------------

export function buildTopology(stdout: string, defaultNamespace = 'default'): TopologyGraph {
  const resources = parseResources(stdout, defaultNamespace)

  const nodes = new Map<string, TopologyNode>()
  // Resolve references by kind+namespace+name, ignoring apiGroup which refs omit.
  const byKindName = new Map<string, ParsedResource>()
  for (const r of resources) {
    byKindName.set(`${r.kind}|${r.namespace}|${r.name}`, r)
    nodes.set(r.id, {
      id: r.id,
      kind: r.kind,
      name: r.name,
      namespace: r.namespace,
      apiGroup: r.apiGroup,
      group: r.group,
      docIndex: r.docIndex,
      source: r.source,
      body: r.body,
    })
  }

  const edges = new Map<string, TopologyEdge>()

  // Resolve a reference to a node id, synthesizing a faded external node when
  // the target is not part of the rendered set.
  function resolve(kind: string, name: string, namespace: string): string {
    const ns = isClusterScoped(kind) ? '' : namespace
    const found = byKindName.get(`${kind}|${ns}|${name}`)
    if (found) return found.id
    const id = nodeId('', kind, ns, name)
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        kind,
        name,
        namespace: ns,
        apiGroup: '',
        group: groupForKind(kind),
        docIndex: -1,
        source: '',
        body: '',
        external: true,
      })
    }
    return id
  }

  function link(sourceId: string, targetId: string, type: EdgeType, label: string) {
    if (sourceId === targetId) return
    const id = `${sourceId}->${targetId}:${type}`
    const existing = edges.get(id)
    if (existing) {
      if (label && !existing.label.split(', ').includes(label)) {
        existing.label = existing.label ? `${existing.label}, ${label}` : label
      }
      return
    }
    edges.set(id, {
      id,
      source: sourceId,
      target: targetId,
      type,
      label,
      dangling: nodes.get(targetId)?.external === true,
    })
  }

  function linkRef(sourceId: string, kind: string, name: string, namespace: string, type: EdgeType, label: string) {
    if (!name) return
    link(sourceId, resolve(kind, name, namespace), type, label)
  }

  const workloads = resources.filter((r) => r.group === 'workload')

  for (const r of resources) {
    const ns = r.namespace

    if (r.kind === 'Service') {
      const sel = strMap(get(r.raw, 'spec', 'selector'))
      if (Object.keys(sel).length > 0) {
        for (const w of workloads) {
          if (w.namespace === ns && mapSelectorMatches(sel, podLabels(w))) {
            link(r.id, w.id, 'selects', 'selector')
          }
        }
      }
    }

    if (r.kind === 'PodDisruptionBudget') {
      const sel = get(r.raw, 'spec', 'selector')
      for (const w of workloads) {
        if (w.namespace === ns && labelSelectorMatches(sel, podLabels(w))) {
          link(r.id, w.id, 'selects', 'pdb')
        }
      }
    }

    if (r.kind === 'NetworkPolicy') {
      const sel = get(r.raw, 'spec', 'podSelector')
      const empty = labelSelectorIsEmpty(sel)
      for (const w of workloads) {
        if (w.namespace !== ns) continue
        if (empty || labelSelectorMatches(sel, podLabels(w))) {
          link(r.id, w.id, 'selects', empty ? 'all pods' : 'podSelector')
        }
      }
    }

    if (r.kind === 'Ingress') {
      for (const rule of asArr(get(r.raw, 'spec', 'rules'))) {
        for (const p of asArr(get(rule, 'http', 'paths'))) {
          const svc = asStr(get(p, 'backend', 'service', 'name')) ?? asStr(get(p, 'backend', 'serviceName'))
          if (svc) linkRef(r.id, 'Service', svc, ns, 'routes', 'path')
        }
      }
      const def =
        asStr(get(r.raw, 'spec', 'defaultBackend', 'service', 'name')) ??
        asStr(get(r.raw, 'spec', 'backend', 'serviceName'))
      if (def) linkRef(r.id, 'Service', def, ns, 'routes', 'default')
      for (const tls of asArr(get(r.raw, 'spec', 'tls'))) {
        const sec = asStr(get(tls, 'secretName'))
        if (sec) linkRef(r.id, 'Secret', sec, ns, 'uses-secret', 'tls')
      }
    }

    if (r.kind === 'HorizontalPodAutoscaler') {
      const kind = asStr(get(r.raw, 'spec', 'scaleTargetRef', 'kind'))
      const name = asStr(get(r.raw, 'spec', 'scaleTargetRef', 'name'))
      if (kind && name) linkRef(r.id, kind, name, ns, 'scales', 'scaleTargetRef')
    }

    if (r.kind === 'RoleBinding' || r.kind === 'ClusterRoleBinding') {
      for (const subj of asArr(get(r.raw, 'subjects'))) {
        if (asStr(get(subj, 'kind')) === 'ServiceAccount') {
          const sName = asStr(get(subj, 'name'))
          const sNs = asStr(get(subj, 'namespace')) ?? ns
          if (sName) linkRef(r.id, 'ServiceAccount', sName, sNs, 'binds', 'subject')
        }
      }
      const roleKind = asStr(get(r.raw, 'roleRef', 'kind'))
      const roleName = asStr(get(r.raw, 'roleRef', 'name'))
      if (roleKind && roleName) linkRef(r.id, roleKind, roleName, ns, 'binds', 'roleRef')
    }

    if (r.group === 'workload') {
      const spec = podSpec(r)
      if (spec) {
        const sa = asStr(spec.serviceAccountName) ?? asStr(spec.serviceAccount)
        if (sa) linkRef(r.id, 'ServiceAccount', sa, ns, 'uses-account', 'serviceAccountName')

        for (const ips of asArr(spec.imagePullSecrets)) {
          const n = asStr(get(ips, 'name'))
          if (n) linkRef(r.id, 'Secret', n, ns, 'uses-secret', 'imagePullSecret')
        }

        for (const vol of asArr(spec.volumes)) {
          const cm = asStr(get(vol, 'configMap', 'name'))
          if (cm) linkRef(r.id, 'ConfigMap', cm, ns, 'uses-config', 'volume')
          const sec = asStr(get(vol, 'secret', 'secretName'))
          if (sec) linkRef(r.id, 'Secret', sec, ns, 'uses-secret', 'volume')
          const pvc = asStr(get(vol, 'persistentVolumeClaim', 'claimName'))
          if (pvc) linkRef(r.id, 'PersistentVolumeClaim', pvc, ns, 'mounts', 'volume')
          for (const src of asArr(get(vol, 'projected', 'sources'))) {
            const pcm = asStr(get(src, 'configMap', 'name'))
            if (pcm) linkRef(r.id, 'ConfigMap', pcm, ns, 'uses-config', 'projected')
            const psec = asStr(get(src, 'secret', 'name'))
            if (psec) linkRef(r.id, 'Secret', psec, ns, 'uses-secret', 'projected')
          }
        }

        const containers = [...asArr(spec.containers), ...asArr(spec.initContainers)]
        for (const c of containers) {
          for (const ef of asArr(get(c, 'envFrom'))) {
            const cm = asStr(get(ef, 'configMapRef', 'name'))
            if (cm) linkRef(r.id, 'ConfigMap', cm, ns, 'uses-config', 'envFrom')
            const sec = asStr(get(ef, 'secretRef', 'name'))
            if (sec) linkRef(r.id, 'Secret', sec, ns, 'uses-secret', 'envFrom')
          }
          for (const e of asArr(get(c, 'env'))) {
            const cm = asStr(get(e, 'valueFrom', 'configMapKeyRef', 'name'))
            if (cm) linkRef(r.id, 'ConfigMap', cm, ns, 'uses-config', 'env')
            const sec = asStr(get(e, 'valueFrom', 'secretKeyRef', 'name'))
            if (sec) linkRef(r.id, 'Secret', sec, ns, 'uses-secret', 'env')
          }
        }
      }

      if (r.kind === 'StatefulSet') {
        for (const vct of asArr(get(r.raw, 'spec', 'volumeClaimTemplates'))) {
          const n = asStr(get(vct, 'metadata', 'name'))
          if (n) linkRef(r.id, 'PersistentVolumeClaim', n, ns, 'mounts', 'volumeClaimTemplate')
        }
      }
    }

    for (const owner of asArr(get(r.raw, 'metadata', 'ownerReferences'))) {
      const kind = asStr(get(owner, 'kind'))
      const name = asStr(get(owner, 'name'))
      if (kind && name) link(resolve(kind, name, ns), r.id, 'owns', 'ownerRef')
    }
  }

  const nodeList = [...nodes.values()].sort(
    (a, b) =>
      a.group.localeCompare(b.group) ||
      a.kind.localeCompare(b.kind) ||
      a.namespace.localeCompare(b.namespace) ||
      a.name.localeCompare(b.name),
  )
  const edgeList = [...edges.values()].sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.type.localeCompare(b.type) ||
      a.target.localeCompare(b.target),
  )

  return { nodes: nodeList, edges: edgeList }
}
