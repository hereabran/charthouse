import { Box, Network, FileText, Shield, Database, Gauge, Boxes, type LucideIcon } from 'lucide-react'
import type { NodeGroup } from '@/lib/topology'

// Gruvbox color + icon per resource group, shared by nodes, minimap, and legend.
export const GROUP_THEME: Record<NodeGroup, { color: string; label: string; Icon: LucideIcon }> = {
  workload: { color: 'var(--gv-blue)', label: 'Workload', Icon: Box },
  networking: { color: 'var(--gv-aqua)', label: 'Networking', Icon: Network },
  config: { color: 'var(--gv-yellow)', label: 'Config', Icon: FileText },
  rbac: { color: 'var(--gv-red)', label: 'RBAC', Icon: Shield },
  storage: { color: 'var(--gv-purple)', label: 'Storage', Icon: Database },
  autoscaling: { color: 'var(--gv-green)', label: 'Autoscaling', Icon: Gauge },
  other: { color: 'var(--gv-dim)', label: 'Other', Icon: Boxes },
}
