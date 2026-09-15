import { create } from "zustand";
import { parseOpenApiSource } from "./lib/visualizer";
import { sampleOpenApi } from "./lib/sample";
import type { VisualDocument } from "./types";

export type LayoutDirection = "LR" | "TB";
export type Theme = "light" | "dark";

function preferredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem("openapi-visualizer-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

interface AppState {
  document: VisualDocument | undefined;
  fileName: string | undefined;
  parseError: string | undefined;
  selectedId: string;
  expandedIds: string[];
  direction: LayoutDirection;
  methodFilter: string[];
  fitNonce: number;
  focusNodeId: string;
  isSample: boolean;
  theme: Theme;
  loadSource: (source: string, fileName: string) => boolean;
  loadSample: () => void;
  selectNode: (id: string) => void;
  toggleNode: (id: string) => void;
  revealNode: (id: string) => void;
  resetVisualization: () => void;
  setDirection: (direction: LayoutDirection) => void;
  toggleMethodFilter: (method: string) => void;
  clearFilters: () => void;
  toggleTheme: () => void;
}

function initialExpanded(document: VisualDocument) {
  return ["visualizer:root"];
}

function ensureBranch(document: VisualDocument, id: string, expanded: Set<string>) {
  const model = document.models.get(id);
  if (!model) return;
  let current = model.primaryParentId ? document.models.get(model.primaryParentId) : undefined;
  const chain: string[] = [];
  while (current) {
    chain.unshift(current.id);
    current = current.primaryParentId ? document.models.get(current.primaryParentId) : undefined;
  }
  chain.forEach((ancestor) => {
    if (ancestor !== "visualizer:root") expanded.add(ancestor);
  });
}

function reachable(document: VisualDocument, expanded: Set<string>) {
  const visible = new Set<string>(["visualizer:root"]);
  const outgoing = new Map<string, string[]>();
  for (const edge of document.edges) {
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  }
  const queue = ["visualizer:root"];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (!expanded.has(current)) continue;
    for (const target of outgoing.get(current) ?? []) {
      if (document.models.has(target) && !visible.has(target)) {
        visible.add(target);
        queue.push(target);
      }
    }
  }
  return visible;
}

export const useAppStore = create<AppState>((set, get) => ({
  document: undefined,
  fileName: undefined,
  parseError: undefined,
  selectedId: "visualizer:root",
  expandedIds: [],
  direction: "LR",
  methodFilter: [],
  fitNonce: 0,
  focusNodeId: "visualizer:root",
  isSample: false,
  theme: preferredTheme(),

  loadSource: (source, fileName) => {
    const result = parseOpenApiSource(source, fileName);
    if (!result.document || result.error) {
      set({
        document: undefined,
        fileName,
        parseError: result.error ?? "Unable to parse OpenAPI document.",
      });
      return false;
    }
    const document = result.document;
    set({
      document,
      fileName,
      parseError: undefined,
      selectedId: "visualizer:root",
      expandedIds: initialExpanded(document),
      direction: get().direction,
      methodFilter: [],
      fitNonce: get().fitNonce + 1,
      focusNodeId: "visualizer:root",
      isSample: false,
    });
    return true;
  },

  loadSample: () => {
    const result = parseOpenApiSource(sampleOpenApi, "modern-petstore-3.1.openapi.yaml");
    if (!result.document || result.error) {
      set({ parseError: result.error ?? "Unable to load sample." });
      return;
    }
    set({
      document: result.document,
      fileName: "modern-petstore-3.1.openapi.yaml",
      parseError: undefined,
      selectedId: "visualizer:root",
      expandedIds: initialExpanded(result.document),
      methodFilter: [],
      fitNonce: get().fitNonce + 1,
      focusNodeId: "visualizer:root",
      isSample: true,
    });
  },

  selectNode: (id) => {
    set({ selectedId: id });
  },

  toggleNode: (id) => {
    const { document, expandedIds } = get();
    if (!document) return;
    const expanded = new Set(expandedIds);
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    set({
      selectedId: id,
      expandedIds: [...expanded],
      fitNonce: get().fitNonce + 1,
      focusNodeId: id,
    });
  },

  revealNode: (id) => {
    const { document, expandedIds } = get();
    if (!document || !document.models.has(id)) return;
    const expanded = new Set(expandedIds);
    ensureBranch(document, id, expanded);
    set({
      selectedId: id,
      expandedIds: [...expanded],
      fitNonce: get().fitNonce + 1,
      focusNodeId: id,
    });
  },

  resetVisualization: () => {
    const { document } = get();
    if (!document) return;
    set({
      selectedId: "visualizer:root",
      expandedIds: initialExpanded(document),
      fitNonce: get().fitNonce + 1,
      focusNodeId: "visualizer:root",
    });
  },

  setDirection: (direction) =>
    set({
      direction,
      fitNonce: get().fitNonce + 1,
      focusNodeId: get().selectedId,
    }),
  toggleMethodFilter: (method) => {
    const current = new Set(get().methodFilter);
    if (current.has(method)) current.delete(method);
    else current.add(method);
    set({ methodFilter: [...current] });
  },
  clearFilters: () => set({ methodFilter: [] }),
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    if (typeof window !== "undefined") {
      window.localStorage.setItem("openapi-visualizer-theme", next);
    }
    set({ theme: next });
  },
}));

export function computeVisibleNodes(document: VisualDocument, expandedIds: string[]) {
  return reachable(document, new Set(expandedIds));
}
