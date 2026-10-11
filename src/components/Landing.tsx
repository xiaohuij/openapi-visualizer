import { useRef, useState } from "react";
import {
  AlertTriangle,
  Dog,
  FileUp,
  GitBranch,
  Layers,
  ShieldCheck,
  Sparkles,
  Waypoints,
  ZoomIn,
} from "lucide-react";
import { useAppStore } from "../store";
import {
  loadArazzoSample,
  loadOpenApiSample,
  loadWorkspaceFile,
  loadWorkspaceSource,
} from "../workflow/load";
import { useWorkflowStore } from "../workflow/store";
import { useT } from "../i18n";

function features(t: ReturnType<typeof useT>) {
  return [
  {
    icon: Waypoints,
    title: t("landing.feature.progressive.title"),
    description: t("landing.feature.progressive.description"),
  },
  {
    icon: GitBranch,
    title: t("landing.feature.references.title"),
    description: t("landing.feature.references.description"),
  },
  {
    icon: Layers,
    title: t("landing.feature.coverage.title"),
    description: t("landing.feature.coverage.description"),
  },
  {
    icon: ZoomIn,
    title: t("landing.feature.inspection.title"),
    description: t("landing.feature.inspection.description"),
  },
  {
    icon: ShieldCheck,
    title: t("landing.feature.local.title"),
    description: t("landing.feature.local.description"),
  },
  ];
}

export function Landing() {
  const t = useT();
  const loadSample = useAppStore((state) => state.loadSample);
  const parseError = useAppStore((state) => state.parseError);
  const workflowError = useWorkflowStore((state) => state.lastError);
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    await loadWorkspaceFile(file);
  }

  return (
    <main
      className={`landing ${dragging ? "dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void handleFile(file);
      }}
    >
      <section className="hero">
        <span className="hero-badge">
          <Sparkles size={15} />
          OpenAPI 2.0 · 3.0 · 3.1 · 3.2
        </span>
        <h1>
          {t("landing.headline1")} <em>{t("landing.headline2")}</em>
        </h1>
        <p>{t("landing.subhead")}</p>
        <div className="hero-actions">
          <button className="primary-button large" onClick={() => inputRef.current?.click()}>
            <FileUp size={17} />
            {t("landing.openYaml")}
          </button>
          <button
            className="ghost-button large"
            onClick={() => {
              loadSample();
              loadOpenApiSample();
            }}
          >
            <Dog size={17} />
            {t("landing.tryPetstore")}
          </button>
          <button className="ghost-button large" onClick={loadArazzoSample}>
            <Waypoints size={17} />
            {t("landing.tryArazzo")}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".yaml,.yml,.json,application/yaml,application/json"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) await handleFile(file);
            event.target.value = "";
          }}
        />
        {parseError || workflowError ? (
          <div className="parse-error">
            <AlertTriangle size={16} />
            {parseError ?? workflowError}
          </div>
        ) : null}
      </section>

      <section className="paste-panel">
        <label htmlFor="paste">{t("landing.pasteLabel")}</label>
        <textarea
          id="paste"
          value={pasted}
          spellCheck={false}
          placeholder={t("landing.pastePlaceholder")}
          onChange={(event) => setPasted(event.target.value)}
        />
        <button
          className="primary-button"
          disabled={pasted.trim().length === 0}
          onClick={() => loadWorkspaceSource(pasted, "pasted-document.yaml")}
        >
          {t("landing.build")}
        </button>
      </section>

      <section className="feature-grid">
        {features(t).map((feature) => (
          <article key={feature.title}>
            <span>
              <feature.icon size={19} />
            </span>
            <h2>{feature.title}</h2>
            <p>{feature.description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
