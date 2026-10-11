import { VisualizerCanvas } from "./VisualizerCanvas";
import { InspectorPanel } from "./InspectorPanel";
import { useT } from "../i18n";

export function ApiWorkspace({
  inspectorOpen,
  onToggleInspector,
}: {
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}) {
  const t = useT();
  return (
    <main className={`workspace${inspectorOpen ? " inspector-open" : ""}`}>
      <section className="visualizer-shell">
        <VisualizerCanvas />
        <div className="legend">
          <span className="legend-title">{t("legend.relationships")}</span>
          <span className="legend-item contains">{t("legend.contains")}</span>
          <span className="legend-item request">{t("legend.request")}</span>
          <span className="legend-item response">{t("legend.response")}</span>
          <span className="legend-item ref">{t("legend.ref")}</span>
          <span className="legend-item security">{t("legend.security")}</span>
          <span className="legend-item tag">{t("legend.tag")}</span>
        </div>
      </section>
      <InspectorPanel open={inspectorOpen} onToggle={onToggleInspector} />
    </main>
  );
}
