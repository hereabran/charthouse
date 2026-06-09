// Data model for the resource-topology graph inferred from rendered manifests.

export type NodeGroup =
  | 'workload'
  | 'networking'
  | 'config'
  | 'rbac'
  | 'storage'
  | 'autoscaling'
  | 'other'

export type EdgeType =
  | 'selects' // Service / PDB / NetworkPolicy -> workload (label selector)
  | 'routes' // Ingress -> Service
  | 'uses-config' // workload -> ConfigMap
  | 'uses-secret' // workload/Ingress -> Secret
  | 'uses-account' // workload -> ServiceAccount
  | 'mounts' // workload -> PersistentVolumeClaim
  | 'scales' // HPA -> workload
  | 'binds' // RoleBinding -> ServiceAccount / Role
  | 'owns' // ownerReferences

export type TopologyNode = {
  id: string
  kind: string
  name: string
  namespace: string
  apiGroup: string
  group: NodeGroup
  docIndex: number // index in the rendered output; -1 for synthesized externals
  source: string // the manifest's `# Source:` path, for the detail panel
  body: string // original YAML of this resource, shown when the node is clicked
  external?: boolean // referenced but not present in the rendered set
}

export type TopologyEdge = {
  id: string
  source: string
  target: string
  type: EdgeType
  label: string
  dangling?: boolean // points at an external/unresolved node
}

export type TopologyGraph = {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}
