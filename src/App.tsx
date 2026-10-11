import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { Landing } from "./components/Landing";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { setLocale, useLocale, useT, type Locale } from "./i18n";
import { useAppStore } from "./store";
import { useWorkflowStore } from "./workflow/store";

const ApiWorkspaceSurface = lazy(() =>
  import("./components/ApiWorkspace").then(module => ({ default: module.ApiWorkspace })),
);
const WorkflowStudio = lazy(() =>
  import("./components/workflow/WorkflowStudio").then(module => ({ default: module.WorkflowStudio })),
);

export function App() {
  const document = useAppStore((state) => state.document);
  const theme = useAppStore((state) => state.theme);
  const surface = useWorkflowStore((state) => state.surface);
  const locale = useLocale();
  const t = useT();
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
        <Suspense fallback={<div className="surface-loading" role="status">{t("app.loadingWorkflow")}</div>}>
          <WorkflowStudio />
        </Suspense>
        <LanguageFooter locale={locale} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TopBar />
      {document ? (
        <>
          <Suspense fallback={<div className="surface-loading" role="status">{t("app.loadingVisualization")}</div>}>
            <ApiWorkspaceSurface inspectorOpen={inspectorOpen} onToggleInspector={toggleInspector} />
          </Suspense>
          <StatusBar />
          <LanguageFooter locale={locale} />
        </>
      ) : (
        <>
          <Landing />
          <LanguageFooter locale={locale} />
        </>
      )}
    </div>
  );
}

function LanguageFooter({ locale }: { locale: Locale }) {
  const t = useT();
  const next: Locale = locale === "zh-CN" ? "en" : "zh-CN";
  return (
    <footer className="app-footer" aria-label={t("footer.languageTitle")}>
      <button
        type="button"
        className="language-switch"
        title={t("footer.languageTitle")}
        onClick={() => setLocale(next)}
      >
        <Languages size={12} />
        {t("footer.language")}
      </button>
    </footer>
  );
}
