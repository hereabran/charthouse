import { CodeEditor } from '@/components/editor/CodeEditor'
import { GROUP_THEME } from './groupTheme'
import type { TopologyNode } from '@/lib/topology'

// Side panel showing the rendered YAML for the selected resource.
export function ResourcePanel({ node }: { node: TopologyNode | null }) {
  if (!node) {
    return (
      <div className="h-full flex items-center justify-center text-gv-dim text-xs p-4 text-center">
        Select a resource to view its rendered manifest.
      </div>
    )
  }

  const theme = GROUP_THEME[node.group]
  const Icon = theme.Icon

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-gv-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="shrink-0" style={{ color: theme.color }}>
            <Icon size={14} />
          </span>
          <span className="text-xs text-gv-fg truncate">
            {node.kind}/{node.name}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-gv-dim">
          {node.namespace && <span className="hp-chip">ns: {node.namespace}</span>}
          {node.source && (
            <span className="truncate" title={node.source}>
              {node.source}
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {node.external ? (
          <div className="h-full flex items-center justify-center text-gv-dim text-xs p-6 text-center">
            <div className="space-y-1">
              <p className="text-gv-orange">external reference</p>
              <p>
                This {node.kind} is referenced by the chart but is not defined in the rendered
                output.
              </p>
            </div>
          </div>
        ) : (
          <CodeEditor
            path={`${node.name}.yaml`}
            value={node.body}
            onChange={() => {}}
            readOnly
            ariaLabel={`Manifest for ${node.kind}/${node.name}`}
          />
        )}
      </div>
    </div>
  )
}
