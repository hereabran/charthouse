import { describe, it, expect } from 'vitest'
import { buildTopology } from './infer'
import type { EdgeType, TopologyGraph, TopologyNode } from './types'

// A representative rendered helm manifest exercising every relationship rule,
// including a dangling ConfigMap/Secret/Role reference (target not in the set).
const RENDERED = `---
# Source: app/templates/serviceaccount.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: web
  namespace: default
---
# Source: app/templates/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: web-config
  namespace: default
data:
  key: value
---
# Source: app/templates/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: web-tls
  namespace: default
type: kubernetes.io/tls
---
# Source: app/templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
  labels:
    app: web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      serviceAccountName: web
      containers:
        - name: web
          image: nginx
          envFrom:
            - configMapRef:
                name: web-config
            - secretRef:
                name: missing-secret
---
# Source: app/templates/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: default
spec:
  selector:
    app: web
  ports:
    - port: 80
---
# Source: app/templates/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  namespace: default
spec:
  tls:
    - secretName: web-tls
  rules:
    - http:
        paths:
          - backend:
              service:
                name: web
---
# Source: app/templates/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web
  namespace: default
spec:
  scaleTargetRef:
    kind: Deployment
    name: web
---
# Source: app/templates/rolebinding.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: web
  namespace: default
subjects:
  - kind: ServiceAccount
    name: web
    namespace: default
roleRef:
  kind: Role
  name: web
  apiGroup: rbac.authorization.k8s.io
`

function findNode(g: TopologyGraph, kind: string, name: string): TopologyNode | undefined {
  return g.nodes.find((n) => n.kind === kind && n.name === name)
}

function hasEdge(
  g: TopologyGraph,
  srcKind: string,
  srcName: string,
  tgtKind: string,
  tgtName: string,
  type: EdgeType,
): boolean {
  const s = findNode(g, srcKind, srcName)
  const t = findNode(g, tgtKind, tgtName)
  if (!s || !t) return false
  return g.edges.some((e) => e.source === s.id && e.target === t.id && e.type === type)
}

describe('buildTopology', () => {
  const g = buildTopology(RENDERED, 'default')

  it('returns an empty graph for empty input', () => {
    expect(buildTopology('')).toEqual({ nodes: [], edges: [] })
  })

  it('parses real resources into nodes', () => {
    expect(findNode(g, 'Deployment', 'web')).toBeTruthy()
    expect(findNode(g, 'Service', 'web')).toBeTruthy()
    expect(findNode(g, 'Ingress', 'web')).toBeTruthy()
  })

  it('infers Service -> workload via selector', () => {
    expect(hasEdge(g, 'Service', 'web', 'Deployment', 'web', 'selects')).toBe(true)
  })

  it('infers Ingress -> Service and Ingress -> Secret (tls)', () => {
    expect(hasEdge(g, 'Ingress', 'web', 'Service', 'web', 'routes')).toBe(true)
    expect(hasEdge(g, 'Ingress', 'web', 'Secret', 'web-tls', 'uses-secret')).toBe(true)
  })

  it('infers workload -> ConfigMap and ServiceAccount', () => {
    expect(hasEdge(g, 'Deployment', 'web', 'ConfigMap', 'web-config', 'uses-config')).toBe(true)
    expect(hasEdge(g, 'Deployment', 'web', 'ServiceAccount', 'web', 'uses-account')).toBe(true)
  })

  it('infers HPA -> workload', () => {
    expect(hasEdge(g, 'HorizontalPodAutoscaler', 'web', 'Deployment', 'web', 'scales')).toBe(true)
  })

  it('infers RoleBinding -> ServiceAccount and -> Role', () => {
    expect(hasEdge(g, 'RoleBinding', 'web', 'ServiceAccount', 'web', 'binds')).toBe(true)
    expect(hasEdge(g, 'RoleBinding', 'web', 'Role', 'web', 'binds')).toBe(true)
  })

  it('synthesizes faded external nodes for dangling references', () => {
    const missing = findNode(g, 'Secret', 'missing-secret')
    expect(missing?.external).toBe(true)
    const role = findNode(g, 'Role', 'web')
    expect(role?.external).toBe(true)
    // dangling edges are flagged
    const danglingEdge = g.edges.find((e) => e.target === missing?.id)
    expect(danglingEdge?.dangling).toBe(true)
  })

  it('guarantees every edge endpoint exists as a node', () => {
    const ids = new Set(g.nodes.map((n) => n.id))
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true)
      expect(ids.has(e.target)).toBe(true)
    }
  })

  it('is deterministic across runs', () => {
    const again = buildTopology(RENDERED, 'default')
    expect(again.nodes.map((n) => n.id)).toEqual(g.nodes.map((n) => n.id))
    expect(again.edges.map((e) => e.id)).toEqual(g.edges.map((e) => e.id))
  })
})
