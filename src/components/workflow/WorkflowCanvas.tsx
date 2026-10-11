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
  ArrowUpRight,
  CircleAlert,
  Database,
  FileJson2,
  GitBranch,
  ListOrdered,
  Radio,
  Waypoints,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import {
  buildArazzoWorkflowGraph,
  type ArazzoGraphEdgeRelation,
  type ArazzoGraphNode,
  type ArazzoGraphNodeType,
} from "../../arazzo/graph-builder";
import type { ArazzoResolution } from "../../arazzo/semantic-resolver";
import { useAppStore } from "../../store";
import { cn } from "../../lib/utils";

interface WorkflowGraphNodeData {
  model: ArazzoGraphNode;
  selected?: boolean;
  execution?: "running" | "succeeded" | "failed" | "blocked";
  [key: string]: unknown;
}

const nodeSizes: Record<ArazzoGraphNodeType, { width: number; height: number }> = {
  document: { width: 270, height: 94 },
  source: { width: 235, height: 88 },
  workflow: { width: 250, height: 88 },
  step: { width: 235, height: 88 },
  "operation-target": { width: 275, height: 100 },
  "workflow-target": { width: 250, height: 88 },
  "asyncapi-target": { width: 275, height: 94 },
  "unresolved-target": { width: 255, height: 88 },
};

const edgeStyles: Record<ArazzoGraphEdgeRelation, { stroke: string; strokeWidth: number; strokeDasharray?: string }> = {
  contains: { stroke: "var(--edge-contains)", strokeWidth: 1.15 },
  "depends-on": { stroke: "var(--edge-ref)", strokeWidth: 1.65, strokeDasharray: "6 5" },
  "operation-call": { stroke: "var(--edge-request)", strokeWidth: 1.75 },
  "workflow-call": { stroke: "var(--edge-response)", strokeWidth: 1.7 },
  "channel-call": { stroke: "var(--edge-tag)", strokeWidth: 1.7, strokeDasharray: "7 4" },
  "unresolved-call": { stroke: "var(--red)", strokeWidth: 1.45, strokeDasharray: "5 5" },
};

function iconFor(kind: ArazzoGraphNodeType) {
  switch (kind) {
    case "document":
      return FileJson2;
    case "source":
      return Database;
    case "workflow":
    case "workflow-target":
      return kind === "workflow" ? Waypoints : GitBranch;
    case "step":
      return ListOrdered;
    case "operation-target":
      return ArrowUpRight;
    case "asyncapi-target":
      return Radio;
    case "unresolved-target":
      return CircleAlert;
  }
}

function typeLabel(kind: ArazzoGraphNodeType) {
  switch (kind) {
    case "operation-target":
      return "Operation";
    case "workflow-target":
      return "Workflow target";
    case "asyncapi-target":
      return "Async target";
    case "unresolved-target":
      return "Unresolved";
    default:
      return kind[0].toUpperCase() + kind.slice(1);
  }
}

function statusLabel(model: ArazzoGraphNode) {
  if (model.kind === "unresolved-target") return "unresolved";
  if (model.kind === "asyncapi-target") return model.resolved ? "bound" : "unbound";
  if (model.kind === "step") return model.resolved ? "resolved" : "unresolved";
  if (model.kind === "source") return model.resolved ? "bound" : "unbound";
  return undefined;
}

function WorkflowGraphNode({ data }: NodeProps) {
  const nodeData = data as unknown as WorkflowGraphNodeData;
  const model = nodeData.model;
  const Icon = iconFor(model.kind);
  const status = statusLabel(model);

  return (
    <div
      className={cn(
        "workflow-graph-node",
        model.kind,
        model.resolved ? "resolved" : "unresolved",
        nodeData.selected && "selected",
        nodeData.execution && `exec-${nodeData.execution}`,
      )}
      aria-selected={nodeData.selected || undefined}
    >
      <Handle type="target" position={Position.Left} id="left" />
      <div className="workflow-graph-node-header">
        <span className="workflow-graph-node-icon">
          <Icon size={14} strokeWidth={2} />
        </span>
        <div>
          <strong title={model.title}>{model.title}</strong>
          {model.subtitle ? <span title={model.subtitle}>{model.subtitle}</span> : null}
        </div>
      </div>
      <div className="workflow-graph-node-footer">
        <span>{typeLabel(model.kind)}</span>
        {status ? <span className={cn("workflow-target", status)}>{status}</span> : null}
      </div>
      <Handle type="source" position={Position.Right} id="right" />
    </div>
  );
}

const nodeTypes = { workflowGraphNode: WorkflowGraphNode };

function layoutNodes(nodes: Node[], edges: Edge[]) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    nodesep: 30,
    ranksep: 72,
    marginx: 34,
    marginy: 34,
    ranker: "network-simplex",
  });

  nodes.forEach((node) => {
    const model = (node.data as unknown as WorkflowGraphNodeData).model;
    const size = nodeSizes[model.kind];
    graph.setNode(node.id, { width: size.width, height: size.height });
  });
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);

  return nodes.map((node) => {
    const model = (node.data as unknown as WorkflowGraphNodeData).model;
    const size = nodeSizes[model.kind];
    const position = graph.node(node.id);
    return {
      ...node,
      position: {
        x: position.x - size.width / 2,
        y: position.y - size.height / 2,
      },
    };
  });
}

function Canvas({
  resolution,
  selectedStepPointer,
  onSelectStep,
  execution,
}: {
  resolution: ArazzoResolution;
  selectedStepPointer?: string;
  onSelectStep?: (pointer: string) => void;
  execution?: {
    states: Map<string, { status: "running" | "succeeded" | "failed" | "blocked" }>;
    activePointer?: string;
  };
}) {
  const theme = useAppStore((state) => state.theme);
  const { fitView } = useReactFlow();
  const graph = useMemo(() => buildArazzoWorkflowGraph(resolution), [resolution]);

  const { nodes, edges } = useMemo(() => {
    const flowNodes = graph.nodes.map((model) => {
      const size = nodeSizes[model.kind];
      return {
        id: model.id,
        type: "workflowGraphNode",
        position: { x: 0, y: 0 },
        style: { width: size.width, height: size.height },
        data: {
          model,
          selected: model.kind === "step" && model.pointer === selectedStepPointer,
          execution: model.kind === "step" ? execution?.states.get(model.pointer)?.status : undefined,
        } satisfies WorkflowGraphNodeData,
      } satisfies Node;
    });
    const flowEdges = graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: "right",
      targetHandle: "left",
      type: "smoothstep",
      label: edge.relation === "contains" ? undefined : edge.relation.replace("-on", " on").replace("-", " "),
      className: `workflow-graph-edge-${edge.relation}`,
      style: edgeStyles[edge.relation],
    })) satisfies Edge[];
    const activeStepNode = graph.nodes.find(
      node => node.kind === "step" && node.pointer === execution?.activePointer,
    );
    const animatedEdges = activeStepNode
      ? flowEdges.map(edge =>
          edge.source === activeStepNode?.id
            ? { ...edge, animated: true }
            : edge,
        )
      : flowEdges;
    return { nodes: layoutNodes(flowNodes, flowEdges), edges: animatedEdges };
  }, [graph, selectedStepPointer, execution]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.2, duration: 420, maxZoom: 1.05 });
    }, 35);
    return () => window.clearTimeout(timer);
  }, [fitView, graph]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      minZoom={0.08}
      maxZoom={2}
      fitView
      className="workflow-flow"
      nodesFocusable
      panOnDrag
      zoomOnScroll
      nodesDraggable={false}
      nodesConnectable={false}
      onNodeClick={(_, node) => {
        const model = (node.data as unknown as WorkflowGraphNodeData).model;
        if (model.kind === "step") onSelectStep?.(model.pointer);
      }}
      proOptions={{ hideAttribution: false }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={25}
        size={1}
        color={theme === "dark" ? "rgba(148, 163, 184, 0.28)" : "rgba(71, 85, 105, 0.24)"}
      />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        className="flow-minimap"
        nodeColor={(node) => minimapColor((node.data as unknown as WorkflowGraphNodeData).model, theme)}
      />
    </ReactFlow>
  );
}

function minimapColor(model: ArazzoGraphNode, theme: "light" | "dark") {
  const palette =
    theme === "light"
      ? {
        document: "#4f46e5",
        source: "#0e7490",
        workflow: "#2563eb",
        step: "#7c3aed",
        "operation-target": "#059669",
        "workflow-target": "#0f766e",
        "asyncapi-target": "#c026d3",
        "unresolved-target": "#dc2626",
      }
      : {
        document: "#818cf8",
        source: "#22d3ee",
        workflow: "#60a5fa",
        step: "#c084fc",
        "operation-target": "#4ade80",
        "workflow-target": "#2dd4bf",
        "asyncapi-target": "#e879f9",
        "unresolved-target": "#f87171",
      };
  return palette[model.kind];
}

export function WorkflowCanvas({
  resolution,
  selectedStepPointer,
  onSelectStep,
  execution,
}: {
  resolution: ArazzoResolution;
  selectedStepPointer?: string;
  onSelectStep?: (pointer: string) => void;
  execution?: {
    states: Map<string, { status: "running" | "succeeded" | "failed" | "blocked" }>;
    activePointer?: string;
  };
}) {
  return (
    <section className="workflow-canvas" aria-label="Workflow graph">
      <ReactFlowProvider>
        <Canvas
          resolution={resolution}
          selectedStepPointer={selectedStepPointer}
          onSelectStep={onSelectStep}
          execution={execution}
        />
      </ReactFlowProvider>
    </section>
  );
}
