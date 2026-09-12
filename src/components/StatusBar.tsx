import { computeVisibleNodes, useAppStore } from "../store";

export function StatusBar() {
  const document = useAppStore((state) => state.document);
  const expandedIds = useAppStore((state) => state.expandedIds);
  const selectedId = useAppStore((state) => state.selectedId);
  const methodFilter = useAppStore((state) => state.methodFilter);
  if (!document) return null;

  const visible = computeVisibleNodes(document, expandedIds);
  const selected = document.models.get(selectedId);
  return (
    <footer className="status-bar">
      <div className="status-chips">
        <span>{document.stats.specification}</span>
        <span>{document.stats.paths} paths</span>
        <span>{document.stats.operations} operations</span>
        <span>{document.stats.webhooks} webhooks</span>
        <span>{document.stats.schemas} schemas</span>
        <span>{document.stats.refs} references</span>
        <span>{visible.size} visible nodes</span>
        <span>{document.edges.length} relationship edges</span>
        {methodFilter.length > 0 ? <span className="active-filter">{methodFilter.join(" · ")}</span> : null}
      </div>
      <div className="selected-location">{selected ? selected.pointer : "#"}</div>
    </footer>
  );
}
