import dagre from 'dagre'
import type { Edge, Node } from '@xyflow/react'
import type { TopologyGraph } from '@/lib/topology'

export const NODE_W = 190
export const NODE_H = 52

// layoutGraph runs a deterministic top-down dagre layout and maps the result
// into React Flow nodes/edges. Computed once per graph; dragging afterward does
// not recompute (see TopologyGraph).
export function layoutGraph(graph: TopologyGraph): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 64, marginx: 16, marginy: 16 })
  for (const n of graph.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H })
  for (const e of graph.edges) g.setEdge(e.source, e.target)
  dagre.layout(g)

  const nodes: Node[] = graph.nodes.map((n) => {
    const p = g.node(n.id)
    return {
      id: n.id,
      type: 'resource',
      // dagre positions are centers; React Flow wants the top-left corner.
      position: { x: (p?.x ?? 0) - NODE_W / 2, y: (p?.y ?? 0) - NODE_H / 2 },
      data: { node: n },
    }
  })

  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label || undefined,
    animated: e.type === 'routes',
    className: e.dangling ? 'ch-edge-dangling' : undefined,
  }))

  return { nodes, edges }
}
