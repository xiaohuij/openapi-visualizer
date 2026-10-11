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
import { useCallback, useEffect, useMemo } from "react";
import {
  buildArazzoWorkflowGraph,
  type ArazzoGraphEdgeRelation,
  type ArazzoGraphNode,
  type ArazzoGraphNodeType,
} from "../../arazzo/graph-builder";
import type { ArazzoResolution } from "../../arazzo/semantic-resolver";
import { useAppStore } from "../../store";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";

interface WorkflowGraphNodeData {
  model: ArazzoGraphNode;
  selected?: boolean;
  execution?: "running" | "succeeded" | "failed" | "blocked";
  chips?: Array<{
    label: string;
    kind: "method" | "source" | "action" | "meta" | "warning";
    onClick?: () => void;
  }>;
  [key: string]: unknown;
}

const nodeSizes: Record<ArazzoGraphNodeType, { width: number; height: number }> = {
  document: { width: 215, height: 72 },
  source: { width: 205, height: 72 },
  workflow: { width: 220, height: 76 },
  step: { width: 265, height: 122 },
  "operation-target": { width: 275, height: 100 },
  "workflow-target": { width: 250, height: 88 },
  "asyncapi-target": { width: 275, height: 94 },
  "unresolved-target": { width: 255, height: 88 },
};

const edgeStyles: Record<ArazzoGraphEdgeRelation, { stroke: string; strokeWidth: number; strokeDasharray?: string }> = {
  contains: { stroke: "var(--edge-contains)", strokeWidth: 0.9, strokeDasharray: "2 6" },
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

export type WorkflowViewMode = "execution" | "structure";

const CALL_RELATIONS = new Set<ArazzoGraphEdgeRelation>([
  "operation-call",
  "workflow-call",
  "channel-call",
  "unresolved-call",
]);
const EXECUTION_EDGE_RELATIONS = new Set<ArazzoGraphEdgeRelation>([
  "depends-on",
]);

/**
 * Execution view absorbs each step's call target into the step node itself:
 * every Arazzo step references exactly one operation, workflow, or channel, so
 * the pure workflow DAG is simply step nodes joined by depends-on edges.
 */
function mergedTargetSubtitle(target: ArazzoGraphNode | undefined, t: ReturnType<typeof useT>) {
  if (!target) return undefined;
  if (target.kind === "operation-target") return target.subtitle;
  if (target.kind === "asyncapi-target") return target.title;
  if (target.kind === "workflow-target") return `${t("exec.workflowLabel")}: ${target.title}`;
  return target.title;
}

function typeLabel(kind: ArazzoGraphNodeType, t: ReturnType<typeof useT>) {
  switch (kind) {
    case "operation-target":
      return t("graph.operation");
    case "workflow-target":
      return t("graph.workflowTarget");
    case "asyncapi-target":
      return t("graph.asyncTarget");
    case "unresolved-target":
      return t("graph.unresolved");
    default:
      return kind === "document" ? t("graph.document")
        : kind === "workflow" ? t("graph.workflow")
        : kind === "step" ? t("graph.step")
        : kind === "source" ? t("graph.document")
        : kind;
  }
}

function statusLabel(model: ArazzoGraphNode, t: ReturnType<typeof useT>) {
  if (model.kind === "unresolved-target") return t("graph.unresolved");
  if (model.kind === "asyncapi-target") return model.resolved ? t("graph.bound") : t("graph.unbound");
  if (model.kind === "step") return model.resolved ? t("graph.resolved") : t("graph.unresolved");
  if (model.kind === "source") return model.resolved ? t("graph.bound") : t("graph.unbound");
  return undefined;
}

function WorkflowGraphNode({ data }: NodeProps) {
  const t = useT();
  const nodeData = data as unknown as WorkflowGraphNodeData;
  const model = nodeData.model;
  const Icon = iconFor(model.kind);
  const status = statusLabel(model, t);

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
        <span>{typeLabel(model.kind, t)}</span>
        {status ? <span className={cn("workflow-target", status)}>{status}</span> : null}
      </div>
      {nodeData.chips?.length ? (
        <div className="workflow-graph-node-chips">
          {nodeData.chips.map((chip, index) =>
            chip.onClick ? (
              <button
                key={`${chip.label}-${index}`}
                type="button"
                className={cn("step-chip", chip.kind, "clickable")}
                onClick={event => {
                  event.stopPropagation();
                  chip.onClick?.();
                }}
              >
                {chip.label}
              </button>
            ) : (
              <span key={`${chip.label}-${index}`} className={cn("step-chip", chip.kind)}>
                {chip.label}
              </span>
            ),
          )}
        </div>
      ) : null}
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
  viewMode,
  onViewModeChange,
  onOpenOperation,
}: {
  resolution: ArazzoResolution;
  selectedStepPointer?: string;
  onSelectStep?: (pointer: string) => void;
  execution?: {
    states: Map<string, { status: "running" | "succeeded" | "failed" | "blocked" }>;
    activePointer?: string;
  };
  viewMode: WorkflowViewMode;
  onViewModeChange: (mode: WorkflowViewMode) => void;
  onOpenOperation?: (documentId: string, nodeId: string) => void;
}) {
  const t = useT();
  const theme = useAppStore((state) => state.theme);
  const { fitView } = useReactFlow();
  const graph = useMemo(() => buildArazzoWorkflowGraph(resolution), [resolution]);

  const displayGraph = useMemo(() => {
    if (viewMode === "structure") return graph;
    const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
    const callTargets = new Map<string, ArazzoGraphNode>();
    for (const edge of graph.edges) {
      if (!CALL_RELATIONS.has(edge.relation)) continue;
      const source = nodeById.get(edge.source);
      if (source?.kind !== "step") continue;
      const target = nodeById.get(edge.target);
      if (target) callTargets.set(edge.source, target);
    }
    const stepNodes = graph.nodes
      .filter(node => node.kind === "step")
      .map(node => ({
        ...node,
        subtitle: mergedTargetSubtitle(callTargets.get(node.id), t) ?? node.subtitle,
      }));
    const stepIds = new Set(stepNodes.map(node => node.id));
    return {
      ...graph,
      nodes: stepNodes,
      edges: graph.edges.filter(edge =>
        EXECUTION_EDGE_RELATIONS.has(edge.relation)
        && stepIds.has(edge.source)
        && stepIds.has(edge.target),
      ),
    };
  }, [graph, viewMode, t]);

  const resolvedStepsByPointer = useMemo(() => {
    const map = new Map<string, (typeof resolution.workflows)[number]["steps"][number]>();
    for (const workflow of resolution.workflows) {
      for (const step of workflow.steps) map.set(step.step.pointer, step);
    }
    return map;
  }, [resolution]);

  const stepChips = useCallback(
    (pointer: string) => {
      const resolved = resolvedStepsByPointer.get(pointer);
      if (!resolved) return undefined;
      const target = resolved.target;
      const chips: NonNullable<WorkflowGraphNodeData["chips"]> = [];
      if (target.kind === "openapi-operation") {
        chips.push({ label: target.operation.method.toUpperCase(), kind: "method", onClick: onOpenOperation ? () => onOpenOperation(target.operation.documentId, target.operation.nodeId) : undefined });
        chips.push({ label: target.sourceName, kind: "source" });
        const paramCount = (resolved.step.parameters ?? []).length;
        if (paramCount > 0) chips.push({ label: `${paramCount} ${t("graph.chips.parameters", { count: paramCount })}`, kind: "meta" });
        if (resolved.step.requestBody) chips.push({ label: t("graph.chips.body"), kind: "meta" });
      } else if (target.kind === "asyncapi-target") {
        chips.push({ label: resolved.step.action ?? target.operation?.action ?? t("graph.asyncTarget"), kind: "action" });
        if (target.operation?.channelId) chips.push({ label: target.operation.channelId, kind: "source" });
      } else if (target.kind === "workflow") {
        chips.push({ label: `${t("exec.workflowLabel")}: ${target.workflowId}`, kind: "action" });
      } else {
        chips.push({ label: t("graph.unresolved"), kind: "warning" });
      }
      return chips;
    },
    [resolvedStepsByPointer, onOpenOperation, t],
  );

  const { nodes, edges } = useMemo(() => {
    const visibleNodes = displayGraph.nodes;
    const visibleNodeIds = new Set(visibleNodes.map(node => node.id));
    const flowNodes = visibleNodes.map((model) => {
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
          chips: model.kind === "step" ? stepChips(model.pointer) : undefined,
        } satisfies WorkflowGraphNodeData,
      } satisfies Node;
    });
    const flowEdges = displayGraph.edges
      .filter(edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
      .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: "right",
      targetHandle: "left",
      type: "smoothstep",
      label: edge.relation === "contains" ? undefined : ({ "depends-on": t("graph.dependsOn"), "operation-call": t("graph.operationCall"), "workflow-call": t("graph.workflowCall"), "channel-call": t("graph.channelCall"), "unresolved-call": t("graph.unresolvedCall") } as Record<string, string>)[edge.relation],
      className: `workflow-graph-edge-${edge.relation}`,
        style: edgeStyles[edge.relation],
      })) satisfies Edge[];
    const activeStepNode = displayGraph.nodes.find(
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
  }, [displayGraph, selectedStepPointer, execution]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.2, duration: 420, maxZoom: 1.05 });
    }, 35);
    return () => window.clearTimeout(timer);
  }, [fitView, displayGraph]);

  return (
    <>
      <div className="workflow-view-toggle" role="group" aria-label={t("workflow.viewMode")}>
        <button
          type="button"
          className={viewMode === "execution" ? "active" : ""}
          onClick={() => onViewModeChange("execution")}
        >
          {t("workflow.viewExecution")}
        </button>
        <button
          type="button"
          className={viewMode === "structure" ? "active" : ""}
          onClick={() => onViewModeChange("structure")}
        >
          {t("workflow.viewStructure")}
        </button>
      </div>
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
    </>
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
  viewMode,
  onViewModeChange,
  onOpenOperation,
}: {
  resolution: ArazzoResolution;
  selectedStepPointer?: string;
  onSelectStep?: (pointer: string) => void;
  execution?: {
    states: Map<string, { status: "running" | "succeeded" | "failed" | "blocked" }>;
    activePointer?: string;
  };
  viewMode: WorkflowViewMode;
  onViewModeChange: (mode: WorkflowViewMode) => void;
  onOpenOperation?: (documentId: string, nodeId: string) => void;
}) {
  return (
    <section className="workflow-canvas" aria-label="Workflow graph">
      <ReactFlowProvider>
        <Canvas
          resolution={resolution}
          selectedStepPointer={selectedStepPointer}
          onSelectStep={onSelectStep}
          execution={execution}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          onOpenOperation={onOpenOperation}
        />
      </ReactFlowProvider>
    </section>
  );
}
