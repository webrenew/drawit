"use client"

import { useState, useCallback, useRef, type DragEvent, useImperativeHandle, forwardRef } from "react"
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type NodeChange,
  type EdgeChange,
  BackgroundVariant,
  Panel,
} from "@xyflow/react"

import { WorkflowNode } from "./workflow-node"
import { NodePalette } from "./node-palette"
import {
  NODE_TEMPLATES,
  type WorkflowNode as WorkflowNodeType,
  type WorkflowEdge,
  type WorkflowNodeType as NodeType,
  type WorkflowConfig,
  type WorkflowConnection,
} from "@/lib/workflow-types"
import { layoutWithDagre, beautifyLayout, analyzeLayoutQuality, type LayoutDirection } from "@/lib/layout/dagre-layout"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Play, Save, Undo, Redo } from "lucide-react"

const nodeTypes = {
  workflowNode: WorkflowNode,
}

const initialNodes: WorkflowNodeType[] = [
  {
    id: "1",
    type: "workflowNode",
    position: { x: 100, y: 200 },
    data: { label: "Start", type: "trigger", icon: "play", description: "Workflow trigger" },
  },
]

const initialEdges: WorkflowEdge[] = []

let nodeId = 2

const generateNodeId = () => `node_${nodeId++}`

export interface WorkflowCanvasHandle {
  addWorkflow: (
    config: WorkflowConfig,
    autoLayout?: boolean,
    direction?: "vertical" | "horizontal",
  ) => void
  clearWorkflow: () => void
  getWorkflowState: () => { nodes: WorkflowNodeType[]; edges: WorkflowEdge[] }
  analyzeWorkflow: () => { issues: string[]; hasOverlaps: boolean; hasPoorSpacing: boolean; qualityScore: number }
  beautifyWorkflow: () => void
}

interface WorkflowCanvasProps {
  className?: string
}

export const WorkflowCanvas = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(function WorkflowCanvas(
  { className },
  ref,
) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<WorkflowNodeType[]>(initialNodes)
  const [edges, setEdges] = useState<WorkflowEdge[]>(initialEdges)
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null)

  useImperativeHandle(ref, () => ({
    addWorkflow: (config: WorkflowConfig, autoLayout = true, direction: "vertical" | "horizontal" = "vertical") => {
      const normalizeConnections = (connections?: WorkflowConnection[]) =>
        (connections || []).map((connection, index) => ({
          id: `edge_${Date.now()}_${index}`,
          source: connection.from,
          target: connection.to,
          label: connection.label,
          animated: connection.animated ?? true,
          style: { stroke: "#6366f1", strokeWidth: 2 },
        }))

      // Create React Flow nodes from config
      let newNodes: WorkflowNodeType[] = config.nodes.map((node) => {
        const template = NODE_TEMPLATES[node.type]
        // Use provided position or default to 0,0 (will be overwritten by auto-layout)
        const position = node.position || { x: 0, y: 0 }

        return {
          id: node.id,
          type: "workflowNode",
          position,
          data: {
            label: node.label,
            type: node.type,
            description: (node.description as string | undefined) || template.description,
            icon: template.icon,
            config: node.config,
            status: "idle" as const,
          },
        } as WorkflowNodeType
      })

      // Create React Flow edges
      const newEdges: WorkflowEdge[] = (config.edges?.length
        ? config.edges.map((edge, index) => ({
            id: edge.id || `edge_${Date.now()}_${index}`,
            source: edge.source,
            target: edge.target,
            label: edge.label,
            animated: edge.animated ?? true,
            style: { stroke: "#6366f1", strokeWidth: 2 },
          }))
        : normalizeConnections(config.connections)) as WorkflowEdge[]

      if (autoLayout) {
        const dagreDirection: LayoutDirection = direction === "horizontal" ? "LR" : "TB"
        newNodes = layoutWithDagre(newNodes as any, newEdges, {
          direction: dagreDirection,
          nodeWidth: 200,
          nodeHeight: 80,
          rankSep: 100,
          nodeSep: 60,
        }) as unknown as WorkflowNodeType[]
      }

      setNodes((prev) => [...prev, ...newNodes])
      setEdges((prev) => [...prev, ...newEdges])

      // Fit view after adding nodes
      setTimeout(() => {
        reactFlowInstance?.fitView({ padding: 0.2 })
      }, 100)
    },

    clearWorkflow: () => {
      setNodes([])
      setEdges([])
    },

    getWorkflowState: () => ({ nodes, edges }),

    analyzeWorkflow: () => {
      return analyzeLayoutQuality(nodes as any, edges)
    },

    beautifyWorkflow: () => {
      const beautifiedNodes = beautifyLayout(nodes as any, edges, {
        direction: "TB",
        nodeWidth: 200,
        nodeHeight: 80,
        rankSep: 120, // Increased spacing
        nodeSep: 80, // Increased spacing
      }) as unknown as WorkflowNodeType[]
      setNodes(beautifiedNodes)

      // Fit view after beautifying
      setTimeout(() => {
        reactFlowInstance?.fitView({ padding: 0.2 })
      }, 100)
    },
  }))

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds as any) as unknown as WorkflowNodeType[]),
    [],
  )

  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)), [])

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: "#6366f1", strokeWidth: 2 },
          },
          eds,
        ),
      ),
    [],
  )

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()

      const type = event.dataTransfer.getData("application/reactflow") as NodeType

      if (!type || !reactFlowInstance || !reactFlowWrapper.current) {
        return
      }

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const template = NODE_TEMPLATES[type]
      const newNode: WorkflowNodeType = {
        id: generateNodeId(),
        type: "workflowNode",
        position,
        data: {
          label: type.charAt(0).toUpperCase() + type.slice(1),
          type,
          ...template,
        },
      }

      setNodes((nds) => [...nds, newNode])
    },
    [reactFlowInstance],
  )

  const runWorkflow = useCallback(() => {
    // Simulate running the workflow
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: { ...node.data, status: "running" as const },
      })),
    )

    // Simulate completion after delay
    setTimeout(() => {
      setNodes((nds) =>
        nds.map((node) => ({
          ...node,
          data: { ...node.data, status: "success" as const },
        })),
      )
    }, 2000)
  }, [])

  return (
    <ReactFlowProvider>
      <div ref={reactFlowWrapper} className={cn("w-full h-full relative z-0", className)}>
        <ReactFlow
          nodes={nodes as any}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes as any}
          fitView
          snapToGrid
          snapGrid={[15, 15]}
          defaultEdgeOptions={{
            animated: true,
            style: { stroke: "#6366f1", strokeWidth: 2 },
          }}
          className="bg-background"
        >
          <Controls className="!bg-background !border !border-border !shadow-sm" />
          <MiniMap
            className="!bg-background !border !border-border"
            nodeColor={(node) => {
              const type = (node.data as any)?.type
              switch (type) {
                case "trigger":
                  return "#22c55e"
                case "action":
                  return "#3b82f6"
                case "condition":
                  return "#f59e0b"
                case "loop":
                  return "#a855f7"
                case "transform":
                  return "#ec4899"
                case "output":
                  return "#14b8a6"
                default:
                  return "#6b7280"
              }
            }}
          />
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />

          {/* Top toolbar */}
          <Panel position="top-center" className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2 bg-background">
              <Undo className="w-4 h-4" />
              Undo
            </Button>
            <Button variant="outline" size="sm" className="gap-2 bg-background">
              <Redo className="w-4 h-4" />
              Redo
            </Button>
            <Button variant="outline" size="sm" className="gap-2 bg-background">
              <Save className="w-4 h-4" />
              Save
            </Button>
            <Button size="sm" className="gap-2" onClick={runWorkflow}>
              <Play className="w-4 h-4" />
              Run
            </Button>
          </Panel>

          {/* Node palette sidebar */}
          <Panel position="top-left" className="!m-0">
            <div className="w-56 h-[calc(100vh-100px)] bg-background border-r border-border overflow-auto">
              <NodePalette />
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  )
})
