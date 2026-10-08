import { useCallback, useEffect, useState } from "react";
import { VisualizerCanvas } from "./components/VisualizerCanvas";
import { InspectorPanel } from "./components/InspectorPanel";
import { Landing } from "./components/Landing";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { WorkflowStudio } from "./components/workflow/WorkflowStudio";
import { useAppStore } from "./store";
import { useWorkflowStore } from "./workflow/store";

export function App() {
  const document = useAppStore((state) => state.document);
  const theme = useAppStore((state) => state.theme);
  const surface = useWorkflowStore((state) => state.surface);
  const [inspectorOpen, setInspectorOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("openapi-visualizer-inspector") === "expanded";
  });

  useEffect(() => {
    const root = window.document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(
      "openapi-visualizer-inspector",
      inspectorOpen ? "expanded" : "collapsed",
    );
  }, [inspectorOpen]);

  const toggleInspector = useCallback(() => {
    setInspectorOpen((open) => !open);
  }, []);

  if (surface === "workflow") {
    return (
      <div className="app-shell">
        <TopBar />
        <WorkflowStudio />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TopBar />
      {document ? (
        <>
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
            <InspectorPanel open={inspectorOpen} onToggle={toggleInspector} />
          </main>
          <StatusBar />
        </>
      ) : (
        <Landing />
      )}
    </div>
  );
}
