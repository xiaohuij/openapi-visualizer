import { useMemo, useRef, useState } from "react";
import { Dog, Download, FileUp, Moon, RotateCcw, Search, Sun, Waypoints } from "lucide-react";
import { useAppStore, type LayoutDirection } from "../store";
import { cn } from "../lib/utils";

const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "TRACE", "QUERY"];
const BUILTIN_METHOD_CLASSES = ["get", "post", "put", "patch", "delete", "options", "head", "trace", "query"];

async function readOpenApiFile(file: File) {
  const text = await file.text();
  const loaded = useAppStore.getState().loadSource(text, file.name);
  if (!loaded) {
    window.alert(useAppStore.getState().parseError);
  }
}

function methodClass(method: string) {
  const normalized = method.toLowerCase();
  return BUILTIN_METHOD_CLASSES.includes(normalized) ? normalized : "additional";
}

export function TopBar() {
  const document = useAppStore((state) => state.document);
  const fileName = useAppStore((state) => state.fileName);
  const direction = useAppStore((state) => state.direction);
  const methodFilter = useAppStore((state) => state.methodFilter);
  const setDirection = useAppStore((state) => state.setDirection);
  const toggleMethodFilter = useAppStore((state) => state.toggleMethodFilter);
  const resetVisualization = useAppStore((state) => state.resetVisualization);
  const revealNode = useAppStore((state) => state.revealNode);
  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const loadSample = useAppStore((state) => state.loadSample);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!document || query.trim().length < 2) return [];
    const needle = query.trim().toLowerCase();
    return document.searchRecords.filter((record) => record.text.includes(needle)).slice(0, 14);
  }, [document, query]);
  const methods = useMemo(() => {
    if (!document) return [] as string[];
    const discovered = new Set<string>();
    for (const model of document.models.values()) {
      if (model.kind === "operation" && typeof model.metadata.method === "string") discovered.add(model.metadata.method);
    }
    return [...discovered].sort((a, b) => {
      const left = METHOD_ORDER.indexOf(a.toUpperCase());
      const right = METHOD_ORDER.indexOf(b.toUpperCase());
      if (left !== -1 || right !== -1) {
        return (left === -1 ? METHOD_ORDER.length : left) - (right === -1 ? METHOD_ORDER.length : right);
      }
      return a.localeCompare(b);
    });
  }, [document]);

  return (
    <header className="top-bar">
      <div className="brand">
        <span className="brand-icon">
          <Waypoints size={21} />
        </span>
        <div>
          <strong>OpenAPI Visualizer</strong>
          <span>{fileName ?? "No document loaded"}</span>
        </div>
      </div>

      <div className="search-wrap">
        <Search size={16} />
        <input
          value={query}
          placeholder="Search endpoints, schemas, fields, descriptions…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) {
              revealNode(results[0].id);
              setQuery("");
              inputRef.current?.blur();
            }
            if (event.key === "Escape") {
              setQuery("");
              inputRef.current?.blur();
            }
          }}
        />
        {query.trim().length >= 2 ? (
          <div className="search-results">
            {results.length === 0 ? <div className="search-empty">No matches</div> : null}
            {results.map((result) => (
              <button
                key={result.id}
                onClick={() => {
                  revealNode(result.id);
                  setQuery("");
                }}
              >
                <strong>{result.title}</strong>
                <span>{result.subtitle ?? result.kind}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="toolbar-groups">
        <div className="segmented">
          {(["LR", "TB"] as LayoutDirection[]).map((item) => (
            <button
              key={item}
              className={direction === item ? "active" : ""}
              onClick={() => setDirection(item)}
              title={item === "LR" ? "Left-to-right layout" : "Top-to-bottom layout"}
              aria-label={item === "LR" ? "Left-to-right layout" : "Top-to-bottom layout"}
            >
              {item === "LR" ? "↔" : "↕"}
            </button>
          ))}
        </div>

        <div className="method-filter">
          {methods.map((method) => (
            <button
              key={method}
              className={cn(methodClass(method), methodFilter.includes(method) && "active")}
              onClick={() => toggleMethodFilter(method)}
              title={METHOD_ORDER.includes(method.toUpperCase()) ? `Filter ${method} operations` : `Additional ${method} operations`}
            >
              {method}
            </button>
          ))}
        </div>

        <button
          className="ghost-button"
          onClick={resetVisualization}
          title="Collapse the visualization to its first layer"
        >
          <RotateCcw size={15} />
          Reset
        </button>

        <button
          className="ghost-button icon-button"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          {theme === "dark" ? "Light" : "Dark"}
        </button>

        {document ? (
          <button
            className="ghost-button"
            onClick={() => {
              const visualModel = {
                file: document.fileName,
                stats: document.stats,
                nodes: [...document.models.values()].map((node) => ({
                  id: node.id,
                  kind: node.kind,
                  title: node.title,
                  pointer: node.pointer,
                })),
                edges: document.edges,
              };
              const blob = new Blob([JSON.stringify(visualModel, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const anchor = window.document.createElement("a");
              anchor.href = url;
              anchor.download = `${document.fileName.replace(/\.(ya?ml|json)$/i, "")}-visual-model.json`;
              anchor.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={15} />
            Visual model
          </button>
        ) : null}

        <button className="primary-button" onClick={() => inputRef.current?.click()}>
          <FileUp size={15} />
          Open file
        </button>
        <button
          className="ghost-button"
          onClick={loadSample}
          title="Use the bundled Modern Petstore OpenAPI 3.2 sample"
        >
          <Dog size={15} />
          PetStore
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".yaml,.yml,.json,application/yaml,application/json"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) await readOpenApiFile(file);
            event.target.value = "";
          }}
        />
      </div>
    </header>
  );
}
