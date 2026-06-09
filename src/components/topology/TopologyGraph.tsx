import { useEffect, useMemo } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { layoutGraph } from './layout'
import { ResourceNode } from './ResourceNode'
import { GROUP_THEME } from './groupTheme'
import type { TopologyGraph, TopologyNode } from '@/lib/topology'

const nodeTypes = { resource: ResourceNode }

function nodeOf(data: unknown): TopologyNode {
  return (data as { node: TopologyNode }).node
}

function Inner({
  graph,
  onSelect,
}: {
  graph: TopologyGraph
  onSelect: (n: TopologyNode | null) => void
}) {
  const base = useMemo(() => layoutGraph(graph), [graph])
  const [nodes, setNodes, onNodesChange] = useNodesState(base.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(base.edges)

  // Re-seed when the graph (i.e. the rendered output) changes.
  useEffect(() => {
    setNodes(base.nodes)
    setEdges(base.edges)
  }, [base, setNodes, setEdges])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => onSelect(nodeOf(n.data))}
      onPaneClick={() => onSelect(null)}
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
      className="ch-flow"
    >
      <Background color="#928374" gap={18} size={1} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => GROUP_THEME[nodeOf(n.data).group]?.color ?? 'var(--gv-dim)'}
        maskColor="rgba(0,0,0,0.45)"
      />
      <Controls />
    </ReactFlow>
  )
}

// Wrapped in a provider so the hooks have their required context.
export function TopologyGraphView(props: {
  graph: TopologyGraph
  onSelect: (n: TopologyNode | null) => void
}) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  )
}
