import type { ArazzoResolution } from "./semantic-resolver";
import type {
  ArazzoDocument,
  ArazzoSourceDescription,
  ArazzoStep,
  ArazzoWorkflow,
} from "./types";
import type { OpenApiOperationCapability } from "../workflow/capability-index";

export type ArazzoGraphNodeType =
  | "document"
  | "source"
  | "workflow"
  | "step"
  | "operation-target"
  | "workflow-target"
  | "asyncapi-target"
  | "unresolved-target";

export type ArazzoGraphEdgeRelation =
  | "contains"
  | "depends-on"
  | "operation-call"
  | "workflow-call"
  | "channel-call"
  | "unresolved-call";

export interface ArazzoGraphNode {
  id: string;
  kind: ArazzoGraphNodeType;
  title: string;
  subtitle?: string;
  pointer: string;
  documentId: string;
  resolved: boolean;
  workflowId?: string;
  stepId?: string;
  sourceName?: string;
  targetDocumentId?: string;
  targetPointer?: string;
  reference?: string;
  operation?: OpenApiOperationCapability;
}

export interface ArazzoGraphEdge {
  id: string;
  source: string;
  target: string;
  relation: ArazzoGraphEdgeRelation;
}

export interface ArazzoWorkflowGraph {
  documentId: string;
  nodes: ArazzoGraphNode[];
  edges: ArazzoGraphEdge[];
}

function localNodeId(document: ArazzoDocument, pointer: string) {
  return `${document.documentId}::${pointer}`;
}

function targetNode(
  document: ArazzoDocument,
  kind: "operation-target" | "workflow-target" | "asyncapi-target",
  title: string,
  subtitle: string,
  pointer: string,
  targetDocumentId: string,
  extras: Partial<ArazzoGraphNode> = {},
): ArazzoGraphNode {
  return {
    id: `${targetDocumentId}::${kind}::${pointer}`,
    kind,
    title,
    subtitle,
    pointer,
    documentId: document.documentId,
    resolved: true,
    targetDocumentId,
    targetPointer: pointer,
    ...extras,
  };
}

function unresolvedNode(
  document: ArazzoDocument,
  owner: ArazzoGraphNode,
  title: string,
  reason: string,
  pointer: string,
): ArazzoGraphNode {
  return {
    id: `${owner.id}::unresolved::${pointer}`,
    kind: "unresolved-target",
    title,
    subtitle: reason,
    pointer,
    documentId: document.documentId,
    resolved: false,
    workflowId: owner.workflowId,
    stepId: owner.stepId,
  };
}

function sourceSubtitle(source: ArazzoSourceDescription, bound: boolean) {
  return bound ? `${source.type} · bound locally` : `${source.type} · unbound`;
}

function stepSubtitle(step: ArazzoStep) {
  return step.description ?? step.operationId ?? step.workflowId ?? "No target declared";
}

function workflowSubtitle(workflow: ArazzoWorkflow) {
  return workflow.summary ?? workflow.description ?? `${workflow.steps.length} steps`;
}

export function buildArazzoWorkflowGraph(resolution: ArazzoResolution): ArazzoWorkflowGraph {
  const { document } = resolution;
  const nodes: ArazzoGraphNode[] = [];
  const edges: ArazzoGraphEdge[] = [];
  const edgeKeys = new Set<string>();

  const addEdge = (
    source: ArazzoGraphNode,
    target: ArazzoGraphNode,
    relation: ArazzoGraphEdgeRelation,
  ) => {
    const key = `${source.id}->${target.id}:${relation}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      id: `${relation}:${key}`,
      source: source.id,
      target: target.id,
      relation,
    });
  };

  const rootNode: ArazzoGraphNode = {
    id: localNodeId(document, "#"),
    kind: "document",
    title: document.info.title,
    subtitle: `Arazzo ${document.version}`,
    pointer: "#",
    documentId: document.documentId,
    resolved: true,
  };
  nodes.push(rootNode);

  const sourceNodesByName = new Map<string, ArazzoGraphNode>();
  for (const resolvedSource of resolution.workflows[0]?.sourceDescriptions ?? []) {
    const source = resolvedSource.source;
    const node: ArazzoGraphNode = {
      id: localNodeId(document, source.pointer),
      kind: "source",
      title: source.name,
      subtitle: sourceSubtitle(source, resolvedSource.status === "bound"),
      pointer: source.pointer,
      documentId: document.documentId,
      resolved: resolvedSource.status === "bound",
      sourceName: source.name,
      targetDocumentId: resolvedSource.targetDocumentId,
    };
    nodes.push(node);
    addEdge(rootNode, node, "contains");
    if (!sourceNodesByName.has(source.name)) sourceNodesByName.set(source.name, node);
  }

  const workflowNodes = new Map<string, ArazzoGraphNode>();
  const stepNodes = new Map<string, ArazzoGraphNode>();
  const stepIdByPointer = new Map<string, string>();

  for (const resolvedWorkflow of resolution.workflows) {
    const workflow = resolvedWorkflow.workflow;
    const workflowNode: ArazzoGraphNode = {
      id: localNodeId(document, workflow.pointer),
      kind: "workflow",
      title: workflow.workflowId,
      subtitle: workflowSubtitle(workflow),
      pointer: workflow.pointer,
      documentId: document.documentId,
      resolved: true,
      workflowId: workflow.workflowId,
    };
    nodes.push(workflowNode);
    workflowNodes.set(workflow.workflowId, workflowNode);
    addEdge(rootNode, workflowNode, "contains");

    for (const resolvedStep of resolvedWorkflow.steps) {
      const step = resolvedStep.step;
      const stepNode: ArazzoGraphNode = {
        id: localNodeId(document, step.pointer),
        kind: "step",
        title: step.stepId,
        subtitle: stepSubtitle(step),
        pointer: step.pointer,
        documentId: document.documentId,
        resolved: false,
        workflowId: workflow.workflowId,
        stepId: step.stepId,
      };
      nodes.push(stepNode);
      stepNodes.set(step.pointer, stepNode);
      stepIdByPointer.set(`${workflow.pointer}:${step.stepId}`, stepNode.id);
      addEdge(workflowNode, stepNode, "contains");
    }
  }

  for (const resolvedWorkflow of resolution.workflows) {
    const workflow = resolvedWorkflow.workflow;
    const workflowNode = workflowNodes.get(workflow.workflowId)!;

    for (const dependency of workflow.dependsOn ?? []) {
      const target = workflowNodes.get(dependency);
      if (target) {
        addEdge(target, workflowNode, "depends-on");
      } else {
        const missing = unresolvedNode(
          document,
          workflowNode,
          dependency,
          "Workflow dependency not found.",
          `${workflow.pointer}/dependsOn`,
        );
        missing.reference = dependency;
        nodes.push(missing);
        addEdge(workflowNode, missing, "unresolved-call");
      }
    }

    for (const resolvedStep of resolvedWorkflow.steps) {
      const step = resolvedStep.step;
      const stepNode = stepNodes.get(step.pointer)!;

      for (const dependency of step.dependsOn ?? []) {
        const dependencyId = stepIdByPointer.get(`${workflow.pointer}:${dependency}`);
        const target = dependencyId ? nodes.find((node) => node.id === dependencyId) : undefined;
        if (target) {
          addEdge(target, stepNode, "depends-on");
        } else {
          const missing = unresolvedNode(
            document,
            stepNode,
            dependency,
            "Step dependency not found.",
            `${step.pointer}/dependsOn`,
          );
          missing.reference = dependency;
          nodes.push(missing);
          addEdge(stepNode, missing, "unresolved-call");
        }
      }

      const target = resolvedStep.target;
      if (target.kind === "openapi-operation") {
        const operation = target.operation;
        const operationNode = targetNode(
          document,
          "operation-target",
          operation.operationId ?? `${operation.method} ${operation.path}`,
          `${operation.method.toUpperCase()} ${operation.path}`,
          operation.pointer,
          operation.documentId,
          {
            sourceName: target.sourceName,
            operation,
          },
        );
        const existing = nodes.find((node) => node.id === operationNode.id);
        if (!existing) nodes.push(operationNode);
        const sourceNode = sourceNodesByName.get(target.sourceName);
        if (sourceNode) addEdge(sourceNode, existing ?? operationNode, "contains");
        addEdge(stepNode, existing ?? operationNode, "operation-call");
        stepNode.resolved = true;
      } else if (target.kind === "asyncapi-target") {
        const asyncTarget: ArazzoGraphNode = {
          id: `${document.documentId}::asyncapi-target::${target.sourceName}::${target.reference}`,
          kind: "asyncapi-target",
          title: target.reference,
          subtitle: `${target.resolved ? "bound" : "unbound"} · ${step.action ?? "async"}`,
          pointer: `${step.pointer}/${step.channelPath ? "channelPath" : "operationId"}`,
          documentId: document.documentId,
          resolved: target.resolved,
          sourceName: target.sourceName,
          targetDocumentId: target.targetDocumentId,
          targetPointer: target.reference,
          reference: target.reference,
        };
        const existing = nodes.find(node => node.id === asyncTarget.id);
        if (!existing) nodes.push(asyncTarget);
        const sourceNode = sourceNodesByName.get(target.sourceName);
        if (sourceNode) addEdge(sourceNode, existing ?? asyncTarget, "contains");
        addEdge(stepNode, existing ?? asyncTarget, "channel-call");
        stepNode.resolved = target.resolved;
      } else if (target.kind === "workflow") {
        const localWorkflow = document.workflows.find(
          candidate => candidate.workflowId === target.workflowId && target.targetDocumentId === document.documentId,
        );
        let workflowTarget = localWorkflow
          ? workflowNodes.get(target.workflowId)
          : nodes.find(
              node =>
                node.kind === "workflow-target" &&
                node.targetDocumentId === target.targetDocumentId &&
                node.workflowId === target.workflowId,
            );

        if (!workflowTarget) {
          workflowTarget = targetNode(
            document,
            "workflow-target",
            target.workflowId,
            target.sourceName ? `workflow · ${target.sourceName}` : "workflow",
            `#/workflows/${target.workflowId}`,
            target.targetDocumentId,
            { workflowId: target.workflowId, sourceName: target.sourceName },
          );
          nodes.push(workflowTarget);
        }

        const sourceNode = target.sourceName ? sourceNodesByName.get(target.sourceName) : undefined;
        if (sourceNode) addEdge(sourceNode, workflowTarget, "contains");
        addEdge(stepNode, workflowTarget, "workflow-call");
        stepNode.resolved = true;
      } else {
        const pointer = step.workflowId ? `${step.pointer}/workflowId` : `${step.pointer}/operationId`;
        const unresolved = unresolvedNode(
          document,
          stepNode,
          step.operationId ?? step.workflowId ?? "No target",
          target.reason,
          pointer,
        );
        unresolved.reference = step.operationId ?? step.workflowId;
        nodes.push(unresolved);
        addEdge(stepNode, unresolved, "unresolved-call");
      }
    }
  }

  return { documentId: document.documentId, nodes, edges };
}
