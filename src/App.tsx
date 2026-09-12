import { useEffect } from "react";
import { VisualizerCanvas } from "./components/VisualizerCanvas";
import { InspectorPanel } from "./components/InspectorPanel";
import { Landing } from "./components/Landing";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { useAppStore } from "./store";

export function App() {
  const document = useAppStore((state) => state.document);
  const theme = useAppStore((state) => state.theme);

  useEffect(() => {
    const root = window.document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }, [theme]);

  return (
    <div className="app-shell">
      <TopBar />
      {document ? (
        <>
          <main className="workspace">
            <section className="visualizer-shell">
              <VisualizerCanvas />
              <div className="legend">
                <span className="legend-title">Relationships</span>
                <span className="legend-item contains">containment</span>
                <span className="legend-item request">request</span>
                <span className="legend-item response">response</span>
                <span className="legend-item ref">$ref / schema</span>
                <span className="legend-item security">security</span>
              </div>
            </section>
            <InspectorPanel />
          </main>
          <StatusBar />
        </>
      ) : (
        <Landing />
      )}
    </div>
  );
}
