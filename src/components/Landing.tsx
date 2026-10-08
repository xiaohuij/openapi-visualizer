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

const features = [
  {
    icon: Waypoints,
    title: "Progressive visualization",
    description:
      "Expand root → paths → operations → payloads → schemas → fields without rendering an unreadable wall of nodes.",
  },
  {
    icon: GitBranch,
    title: "True shared references",
    description:
      "Reusable components and $ref targets remain shared nodes, so the same schema can be reused by many operations.",
  },
  {
    icon: Layers,
    title: "OpenAPI 2.0 → 3.2",
    description:
      "Paths, webhooks, QUERY and additional operations, streaming media types, hierarchical tags, security schemes, and components are normalized.",
  },
  {
    icon: ZoomIn,
    title: "Enterprise inspection",
    description: "Click any node to inspect parameters, schemas, constraints, source YAML, and incoming or outgoing relationships.",
  },
  {
    icon: ShieldCheck,
    title: "Local parsing",
    description: "YAML and JSON files are parsed in your browser; no API document is uploaded to a server.",
  },
];

export function Landing() {
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
          Turn large OpenAPI YAML into an <em>explorable visual model</em>
        </h1>
        <p>
          Load a standard OpenAPI or Swagger JSON/YAML document and expand it layer by layer. Endpoints, request bodies,
          response models, reusable parameters, security schemes, and shared schemas become one connected architecture map.
        </p>
        <div className="hero-actions">
          <button className="primary-button large" onClick={() => inputRef.current?.click()}>
            <FileUp size={17} />
            Open YAML / JSON
          </button>
          <button
            className="ghost-button large"
            onClick={() => {
              loadSample();
              loadOpenApiSample();
            }}
          >
            <Dog size={17} />
            Try PetStore sample
          </button>
          <button className="ghost-button large" onClick={loadArazzoSample}>
            <Waypoints size={17} />
            Try Arazzo workflow
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
        <label htmlFor="paste">Or paste an OpenAPI or Arazzo document</label>
        <textarea
          id="paste"
          value={pasted}
          spellCheck={false}
          placeholder={"openapi: 3.2.0\ninfo:\n  title: My API\npaths:\n  /resources:\n    get: {}"}
          onChange={(event) => setPasted(event.target.value)}
        />
        <button
          className="primary-button"
          disabled={pasted.trim().length === 0}
          onClick={() => loadWorkspaceSource(pasted, "pasted-document.yaml")}
        >
          Build visualization
        </button>
      </section>

      <section className="feature-grid">
        {features.map((feature) => (
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
