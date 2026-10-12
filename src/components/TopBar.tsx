import { useMemo, useRef, useState } from "react";
import { Dog, Download, FileUp, Moon, RotateCcw, Search, Sun, Waypoints } from "lucide-react";
import { cn } from "../lib/utils";
import { useAppStore, type LayoutDirection } from "../store";
import { loadArazzoSample, loadOpenApiSample, loadWorkspaceFile } from "../workflow/load";
import { useWorkflowStore } from "../workflow/store";
import { useT } from "../i18n";

const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "TRACE", "QUERY"];
const BUILTIN_METHOD_CLASSES = ["get", "post", "put", "patch", "delete", "options", "head", "trace", "query"];

function AtlasMark({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id="atlas-green" x1="8" y1="32" x2="40" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#059669" />
          <stop offset="55%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
        <linearGradient id="atlas-purple" x1="52" y1="10" x2="50" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="55%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#c084fc" />
        </linearGradient>
        <linearGradient id="atlas-cyan" x1="42" y1="58" x2="6" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0891b2" />
          <stop offset="55%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
        <radialGradient id="atlas-core" cx="32" cy="32" r="10" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fefce8" stopOpacity="1" />
          <stop offset="100%" stopColor="#fefce8" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Three thick jade arcs, radius 26, stroke 9 — fills 88% of viewBox */}
      <path
        d="M 6 32 A 26 26 0 0 1 38 6"
        stroke="url(#atlas-green)"
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 47 12 A 26 26 0 0 1 52 50"
        stroke="url(#atlas-purple)"
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 47 55 A 26 26 0 0 1 8 40"
        stroke="url(#atlas-cyan)"
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
      />

      {/* Center glow */}
      <circle cx="32" cy="32" r="10" fill="url(#atlas-core)" />
      <circle cx="32" cy="32" r="4" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

function methodClass(method: string) {
  const normalized = method.toLowerCase();
  return BUILTIN_METHOD_CLASSES.includes(normalized) ? normalized : "additional";
}

export function TopBar() {
  const t = useT();
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
  const surface = useWorkflowStore((state) => state.surface);
  const registry = useWorkflowStore((state) => state.registry);
  const workflowRevision = useWorkflowStore((state) => state.revision);
  const setSurface = useWorkflowStore((state) => state.setSurface);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  void workflowRevision;
  const hasArazzoDocument = registry.listArazzo().length > 0;

  const results = useMemo(() => {
    if (surface !== "api" || !document || query.trim().length < 2) return [];
    const needle = query.trim().toLowerCase();
    return document.searchRecords.filter((record) => record.text.includes(needle)).slice(0, 14);
  }, [surface, document, query]);

  const methods = useMemo(() => {
    if (surface !== "api" || !document) return [] as string[];
    const discovered = new Set<string>();
    for (const model of document.models.values()) {
      if (model.kind === "operation" && typeof model.metadata.method === "string") {
        discovered.add(model.metadata.method);
      }
    }
    return [...discovered].sort((a, b) => {
      const left = METHOD_ORDER.indexOf(a.toUpperCase());
      const right = METHOD_ORDER.indexOf(b.toUpperCase());
      if (left !== -1 || right !== -1) {
        return (left === -1 ? METHOD_ORDER.length : left) - (right === -1 ? METHOD_ORDER.length : right);
      }
      return a.localeCompare(b);
    });
  }, [surface, document]);

  return (
    <header className="top-bar">
      <div className="brand">
        <span className="brand-icon">
          <AtlasMark size={36} />
        </span>
        <div>
          <strong>API Atlas</strong>
          <span>{surface === "workflow" ? t("app.workflowStudio") : fileName ?? t("app.noDocument")}</span>
        </div>
      </div>

      {surface === "api" ? (
        <div className="search-wrap">
          <Search size={16} />
          <input
            value={query}
            placeholder={t("topbar.searchPlaceholder")}
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
              {results.length === 0 ? <div className="search-empty">{t("topbar.noMatches")}</div> : null}
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
      ) : (
        <div className="workflow-top-status" role="status">
          {t("topbar.localWorkspace", { count: registry.list().length })}
        </div>
      )}

      <div className="toolbar-groups">
        <div className="segmented surface-switch" role="group" aria-label={t("topbar.workspaceSurface")}>
          <button
            type="button"
            className={surface === "api" ? "active" : ""}
            onClick={() => setSurface("api")}
            aria-pressed={surface === "api"}
          >
            API
          </button>
          <button
            type="button"
            className={surface === "workflow" ? "active" : ""}
            onClick={() => setSurface("workflow")}
            disabled={!hasArazzoDocument}
            aria-pressed={surface === "workflow"}
            title={hasArazzoDocument ? t("topbar.switchToWorkflow") : t("topbar.importArazzoFirst")}
          >
            Flow
          </button>
        </div>

        <div className={cn("segmented", surface !== "api" && "hidden")} aria-hidden={surface !== "api"}>
          {(["LR", "TB"] as LayoutDirection[]).map((item) => (
            <button
              key={item}
              type="button"
              className={direction === item ? "active" : ""}
              onClick={() => setDirection(item)}
              title={item === "LR" ? t("topbar.lrLayout") : t("topbar.tbLayout")}
              aria-label={item === "LR" ? t("topbar.lrLayout") : t("topbar.tbLayout")}
              tabIndex={surface === "api" ? 0 : -1}
            >
              {item === "LR" ? "↔" : "↕"}
            </button>
          ))}
        </div>

        <div className={cn("method-filter", surface !== "api" && "hidden")} aria-hidden={surface !== "api"}>
          {methods.map((method) => (
            <button
              key={method}
              type="button"
              className={cn(methodClass(method), methodFilter.includes(method) && "active")}
              onClick={() => toggleMethodFilter(method)}
              title={
                METHOD_ORDER.includes(method.toUpperCase())
                  ? t("topbar.filterMethod", { method })
                  : t("topbar.additionalMethod", { method })
              }
              tabIndex={surface === "api" ? 0 : -1}
            >
              {method}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="ghost-button"
          onClick={resetVisualization}
          hidden={surface !== "api"}
          title={t("topbar.resetTitle")}
        >
          <RotateCcw size={15} />
          {t("topbar.reset")}
        </button>

        <button
          type="button"
          className="ghost-button icon-button"
          onClick={toggleTheme}
          title={theme === "dark" ? t("topbar.switchLight") : t("topbar.switchDark")}
          aria-label={theme === "dark" ? t("topbar.switchLight") : t("topbar.switchDark")}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          {theme === "dark" ? t("topbar.light") : t("topbar.dark")}
        </button>

        {document && surface === "api" ? (
          <button
            type="button"
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
            {t("topbar.visualModel")}
          </button>
        ) : null}

        <button type="button" className="primary-button" onClick={() => inputRef.current?.click()}>
          <FileUp size={15} />
          {t("topbar.openFile")}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => {
            loadSample();
            loadOpenApiSample();
          }}
          title={t("topbar.petstoreTitle")}
        >
          <Dog size={15} />
          PetStore
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={loadArazzoSample}
          title={t("topbar.petFlowTitle")}
        >
          <Waypoints size={15} />
          Pet flow
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".yaml,.yml,.json,application/yaml,application/json"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) await loadWorkspaceFile(file);
            event.target.value = "";
          }}
        />
      </div>
    </header>
  );
}
