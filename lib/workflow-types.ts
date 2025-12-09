// Workflow types for React Flow-based node editor
import type { Node, Edge } from "@xyflow/react"

export type WorkflowNodeType = "trigger" | "action" | "condition" | "loop" | "transform" | "output"

export interface WorkflowNodeData extends Record<string, unknown> {
  label: string
  type: WorkflowNodeType
  description?: string
  icon?: string
  config?: Record<string, unknown>
  status?: "idle" | "running" | "success" | "error"
}

export type WorkflowNode = Node<WorkflowNodeData>
export type WorkflowEdge = Edge

export interface WorkflowConnection {
  from: string
  to: string
  label?: string
  animated?: boolean
}

export interface WorkflowState {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  selectedNodeId: string | null
}

// Node templates for the node palette
export const NODE_TEMPLATES: Record<WorkflowNodeType, Omit<WorkflowNodeData, "label">> = {
  trigger: {
    type: "trigger",
    description: "Starts the workflow",
    icon: "play",
  },
  action: {
    type: "action",
    description: "Performs an action",
    icon: "zap",
  },
  condition: {
    type: "condition",
    description: "Branches based on condition",
    icon: "git-branch",
  },
  loop: {
    type: "loop",
    description: "Iterates over items",
    icon: "repeat",
  },
  transform: {
    type: "transform",
    description: "Transforms data",
    icon: "shuffle",
  },
  output: {
    type: "output",
    description: "Outputs result",
    icon: "check-circle",
  },
}

// Workflow configuration types for AI-created workflows
export interface WorkflowConfig {
  nodes: {
    id: string
    type: WorkflowNodeType
    label: string
    description?: string
    config?: Record<string, unknown>
    position?: { x: number; y: number }
  }[]
  edges?: {
    id?: string
    source: string
    target: string
    label?: string
    animated?: boolean
  }[]
  connections?: WorkflowConnection[]
}

// The Dagre-based layout provides better, more consistent results
