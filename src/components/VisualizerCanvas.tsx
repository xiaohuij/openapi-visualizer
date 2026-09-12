import dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Box,
  Braces,
  FileJson2,
  Layers,
  Radio,
  Route,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Tag as TagIcon,
  Type,
  Server as ServerIcon,
  ExternalLink,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { computeVisibleNodes, useAppStore } from "../store";
import type { VisualNodeKind, VisualNodeModel } from "../types";
import { cn } from "../lib/utils";

interface VisualNodeData {
  model: VisualNodeModel;
  childCount: number;
  expanded: boolean;
  selected: boolean;
  [key: string]: unknown;
}

const nodeSizes: Record<VisualNodeKind, { width: number; height: number }> = {
  root: { width: 300, height: 112 },
  group: { width: 250, height: 96 },
  path: { width: 280, height: 100 },
  webhook: { width: 280, height: 100 },
  operation: { width: 300, height: 116 },
  parameter: { width: 250, height: 94 },
  requestBody: { width: 250, height: 94 },
  response: { width: 250, height: 94 },
  mediaType: { width: 250, height: 94 },
  schema: { width: 280, height: 108 },
  property: { width: 250, height: 94 },
  schemaVariant: { width: 260, height: 94 },
  securityScheme: { width: 260, height: 94 },
  server: { width: 280, height: 90 },
  tag: { width: 240, height: 84 },
  example: { width: 240, height: 84 },
  externalRef: { width: 300, height: 90 },
  generic: { width: 250, height: 88 },
};

function iconFor(kind: VisualNodeKind) {
  switch (kind) {
    case "root":
      return FileJson2;
    case "group":
      return Layers;
    case "path":
      return Route;
    case "webhook":
      return Radio;
    case "parameter":
      return SlidersHorizontal;
    case "requestBody":
      return ArrowUpRight;
    case "response":
      return ArrowDownLeft;
    case "schema":
    case "property":
    case "schemaVariant":
    case "mediaType":
      return kind === "property" ? Type : Braces;
    case "securityScheme":
      return Shield;
    case "server":
      return ServerIcon;
    case "tag":
      return TagIcon;
    case "example":
      return Sparkles;
    case "externalRef":
      return ExternalLink;
    default:
      return Box;
  }
}

function methodClass(model: VisualNodeModel) {
  if (model.kind !== "operation" || typeof model.metadata.method !== "string") return undefined;
  return `method-${model.metadata.method.toLowerCase()}`;
}

function VisualNodeCard({ data }: NodeProps) {
  const nodeData = data as unknown as VisualNodeData;
  const { model, childCount, expanded, selected } = nodeData;
  const toggleNode = useAppStore((state) => state.toggleNode);
  const selectNode = useAppStore((state) => state.selectNode);
  const Icon = iconFor(model.kind);
  const hasChildren = childCount > 0;

  return (
    <div
      className={cn("visual-node-card", methodClass(model), selected && "selected", model.kind)}
      onClick={(event) => {
        event.stopPropagation();
        selectNode(model.id);
      }}
    >
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Top} id="top" />
      <div className="visual-node-header">
        <span className="visual-node-icon">
          <Icon size={16} strokeWidth={2} />
        </span>
        <div className="visual-node-copy">
          <strong title={model.title}>{model.title}</strong>
          {model.subtitle ? <span title={model.subtitle}>{model.subtitle}</span> : null}
        </div>
      </div>
      <div className="visual-node-footer">
        <span className="visual-node-kind">{prettifyKind(model.kind)}</span>
        {model.metadata.deprecated === true ? <span className="chip danger">deprecated</span> : null}
        {model.kind === "schema" && model.metadata.orphan === true ? (
          <span className="chip muted">orphan</span>
        ) : null}
        {hasChildren ? (
          <button
            type="button"
            className="expand-button"
            onClick={(event) => {
              event.stopPropagation();
              toggleNode(model.id);
            }}
          >
            {expanded ? "−" : `+${childCount}`}
          </button>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </div>
  );
}

const nodeTypes = { visualNode: VisualNodeCard };

function prettifyKind(kind: VisualNodeKind) {
  if (kind === "requestBody") return "Request body";
  if (kind === "response") return "Response";
  if (kind === "securityScheme") return "Security";
  return kind.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function layoutNodes(nodes: Node[], edges: Edge[], direction: "LR" | "TB") {
  const layoutModel = new dagre.graphlib.Graph();
  layoutModel.setDefaultEdgeLabel(() => ({}));
  layoutModel.setGraph({
    rankdir: direction,
    nodesep: direction === "LR" ? 40 : 30,
    ranksep: direction === "LR" ? 90 : 75,
    marginx: 40,
    marginy: 40,
    ranker: "network-simplex",
  });

  nodes.forEach((node) => {
    const kind = (node.data as VisualNodeData).model.kind;
    const size = nodeSizes[kind];
    layoutModel.setNode(node.id, { width: size.width, height: size.height });
  });
  edges.forEach((edge) => layoutModel.setEdge(edge.source, edge.target));
  dagre.layout(layoutModel);

  return nodes.map((node) => {
    const position = layoutModel.node(node.id);
    const kind = (node.data as VisualNodeData).model.kind;
    const size = nodeSizes[kind];
    return {
      ...node,
      position: {
        x: position.x - size.width / 2,
        y: position.y - size.height / 2,
      },
    };
  });
}

function Canvas() {
  const document = useAppStore((state) => state.document);
  const expandedIds = useAppStore((state) => state.expandedIds);
  const selectedId = useAppStore((state) => state.selectedId);
  const direction = useAppStore((state) => state.direction);
  const methodFilter = useAppStore((state) => state.methodFilter);
  const fitNonce = useAppStore((state) => state.fitNonce);
  const focusNodeId = useAppStore((state) => state.focusNodeId);
  const theme = useAppStore((state) => state.theme);
  const selectNode = useAppStore((state) => state.selectNode);
  const toggleNode = useAppStore((state) => state.toggleNode);
  const { fitView } = useReactFlow();
  const nodesRef = useRef<Node[]>([]);

  const { nodes, edges } = useMemo(() => {
    if (!document) return { nodes: [] as Node[], edges: [] as Edge[] };
    const visible = computeVisibleNodes(document, expandedIds);
    const methodSet = new Set(methodFilter);
    const allowed = new Set(visible);

    if (methodSet.size > 0) {
      for (const id of visible) {
        const model = document.models.get(id);
        if (
          model?.kind === "operation" &&
          typeof model.metadata.method === "string" &&
          !methodSet.has(model.metadata.method)
        ) {
          allowed.delete(id);
        }
      }
    }

    const flowNodes = [...allowed].map((id) => {
      const model = document.models.get(id)!;
      const childCount = document.children.get(id)?.length ?? 0;
      const size = nodeSizes[model.kind];
      return {
        id,
        type: "visualNode",
        position: { x: 0, y: 0 },
        style: { width: size.width, height: size.height },
        data: {
          model,
          childCount,
          expanded: expandedIds.includes(id),
          selected: id === selectedId,
        } satisfies VisualNodeData,
      } satisfies Node;
    });

    const flowEdges = document.edges
      .filter((edge) => allowed.has(edge.source) && allowed.has(edge.target))
      .map((edge) => {
        const isRequestResponse = edge.relation === "request" || edge.relation === "response";
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: direction === "LR" ? "right" : "bottom",
          targetHandle: direction === "LR" ? "left" : "top",
          type: "smoothstep",
          animated: edge.relation === "ref" || isRequestResponse,
          label: edge.relation === "contains" ? undefined : edge.relation,
          className: `edge-${edge.relation}`,
          style: edgeStyle(edge.relation),
        } satisfies Edge;
      });

    return { nodes: layoutNodes(flowNodes, flowEdges, direction), edges: flowEdges };
  }, [document, expandedIds, selectedId, direction, methodFilter]);

  nodesRef.current = nodes;

  useEffect(() => {
    if (nodesRef.current.length === 0) return;
    const timer = window.setTimeout(() => {
      const target = nodesRef.current.find((node) => node.id === focusNodeId);
      if (target) {
        // A mutation can move the operated node after a Dagre relayout. Keeping the
        // operated node centered preserves the user's place in a large visualization.
        void fitView({
          nodes: [{ id: focusNodeId }],
          padding: 0.32,
          duration: 560,
          maxZoom: 1,
          minZoom: 0.2,
        });
      } else {
        void fitView({ padding: 0.22, duration: 450, maxZoom: 1.15 });
      }
    }, 35);
    return () => window.clearTimeout(timer);
  }, [fitNonce, fitView, focusNodeId]);

  if (!document) return null;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => selectNode(node.id)}
      onNodeDoubleClick={(_, node) => toggleNode(node.id)}
      minZoom={0.08}
      maxZoom={2.2}
      proOptions={{ hideAttribution: false }}
      fitView
      className="openapi-flow"
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={26}
        size={1}
        color={theme === "dark" ? "rgba(148, 163, 184, 0.28)" : "rgba(71, 85, 105, 0.24)"}
      />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        className="flow-minimap"
        nodeColor={(node) => minimapColor((node.data as VisualNodeData).model, theme)}
      />
    </ReactFlow>
  );
}

function edgeStyle(relation: string) {
  switch (relation) {
    case "request":
      return { stroke: "var(--edge-request)", strokeWidth: 1.7 };
    case "response":
      return { stroke: "var(--edge-response)", strokeWidth: 1.7 };
    case "security":
      return { stroke: "var(--edge-security)", strokeWidth: 1.4 };
    case "ref":
      return { stroke: "var(--edge-ref)", strokeWidth: 1.6, strokeDasharray: "6 5" };
    case "parameter":
      return { stroke: "var(--edge-parameter)", strokeWidth: 1.3 };
    default:
      return { stroke: "var(--edge-contains)", strokeWidth: 1.2 };
  }
}

function minimapColor(model: VisualNodeModel, theme: "light" | "dark") {
  if (model.kind === "operation" && typeof model.metadata.method === "string") {
    const colors: Record<string, string> =
      theme === "light"
        ? {
            get: "#2563eb",
            post: "#059669",
            put: "#ea580c",
            patch: "#7c3aed",
            delete: "#dc2626",
            options: "#0284c7",
            head: "#0284c7",
            trace: "#0284c7",
          }
        : {
          get: "#60a5fa",
          post: "#4ade80",
          put: "#fb923c",
          patch: "#c084fc",
          delete: "#f87171",
          options: "#38bdf8",
          head: "#38bdf8",
          trace: "#38bdf8",
        };
      return colors[model.metadata.method.toLowerCase()] ?? (theme === "light" ? "#0284c7" : "#38bdf8");
  }
  if (model.kind === "schema" || model.kind === "property") return theme === "light" ? "#0e7490" : "#22d3ee";
  if (model.kind === "group") return theme === "light" ? "#4f46e5" : "#6366f1";
  if (model.kind === "securityScheme") return theme === "light" ? "#c2410c" : "#fb923c";
  return theme === "light" ? "#0284c7" : "#7dd3fc";
}

export function VisualizerCanvas() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
