import { VisualizerCanvas } from "./VisualizerCanvas";
import { InspectorPanel } from "./InspectorPanel";

export function ApiWorkspace({
  inspectorOpen,
  onToggleInspector,
}: {
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}) {
  return (
    <main className={`workspace${inspectorOpen ? " inspector-open" : ""}`}>
      <section className="visualizer-shell">
        <VisualizerCanvas />
        <div className="legend">
          <span className="legend-title">Relationships</span>
          <span className="legend-item contains">containment</span>
          <span className="legend-item request">request</span>
          <span className="legend-item response">response</span>
          <span className="legend-item ref">$ref / schema</span>
          <span className="legend-item security">security</span>
          <span className="legend-item tag">tag</span>
        </div>
      </section>
      <InspectorPanel open={inspectorOpen} onToggle={onToggleInspector} />
    </main>
  );
}
