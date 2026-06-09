import { Handle, Position, type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import { GROUP_THEME } from './groupTheme'
import type { TopologyNode } from '@/lib/topology'

// A single Gruvbox-styled resource node. React Flow supplies `selected`.
export function ResourceNode({ data, selected }: NodeProps) {
  const node = (data as { node: TopologyNode }).node
  const theme = GROUP_THEME[node.group]
  const Icon = theme.Icon

  return (
    <div
      className={clsx(
        'flex items-center gap-2 px-2 py-1.5 border bg-gv-bg2 text-gv-fg w-[190px] h-[52px] overflow-hidden',
        selected ? 'border-gv-accent ring-1 ring-gv-accent' : 'border-gv-border',
        node.external && 'opacity-60 border-dashed',
      )}
      style={{ borderRadius: 'var(--hp-radius)' }}
      title={`${node.kind}/${node.name}${node.namespace ? ` · ns: ${node.namespace}` : ''}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-gv-dim !border-0 !h-1.5 !w-1.5" />
      <span className="shrink-0" style={{ color: theme.color }}>
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-wide text-gv-dim truncate">
          {node.kind}
          {node.external ? ' · external' : ''}
        </div>
        <div className="text-xs truncate">{node.name}</div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gv-dim !border-0 !h-1.5 !w-1.5" />
    </div>
  )
}
