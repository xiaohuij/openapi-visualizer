import { computeVisibleNodes, useAppStore } from "../store";
import { useT } from "../i18n";

export function StatusBar() {
  const t = useT();
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
        <span>{t("status.paths", { count: document.stats.paths })}</span>
        <span>{t("status.operations", { count: document.stats.operations })}</span>
        <span>{t("status.webhooks", { count: document.stats.webhooks })}</span>
        <span>{t("status.schemas", { count: document.stats.schemas })}</span>
        {document.stats.mediaTypes > 0 ? <span>{t("status.mediaTypes", { count: document.stats.mediaTypes })}</span> : null}
        {document.stats.additionalOperations > 0 ? (
          <span>{t("status.additionalOperations", { count: document.stats.additionalOperations })}</span>
        ) : null}
        {document.stats.streamingMediaTypes > 0 ? (
          <span>{t("status.streamingMediaTypes", { count: document.stats.streamingMediaTypes })}</span>
        ) : null}
        <span>{t("status.references", { count: document.stats.refs })}</span>
        {document.stats.unresolvedInternalRefs > 0 ? (
          <span className="active-filter">{t("status.unresolvedRefs", { count: document.stats.unresolvedInternalRefs })}</span>
        ) : null}
        <span>{t("status.visibleNodes", { count: visible.size })}</span>
        <span>{t("status.relationshipEdges", { count: document.edges.length })}</span>
        {methodFilter.length > 0 ? <span className="active-filter">{methodFilter.join(" · ")}</span> : null}
      </div>
      <div className="selected-location">{selected ? selected.pointer : "#"}</div>
    </footer>
  );
}
