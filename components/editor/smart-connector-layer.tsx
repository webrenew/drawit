"use client"

/**
 * SMART CONNECTOR LAYER
 *
 * This component uses React Flow ONLY for connection path rendering, not for node management.
 *
 * Why React Flow is used here:
 * - React Flow provides excellent path algorithms (bezier, smoothstep, straight)
 * - It handles connection routing, edge labels, and arrow heads automatically
 * - We leverage its rendering engine without using its node management features
 *
 * How it works:
 * 1. Creates INVISIBLE React Flow nodes at each canvas element's position
 * 2. These nodes have transparent handles (top, bottom, left, right)
 * 3. React Flow edges connect these invisible nodes
 * 4. The connection paths are rendered, but nodes remain invisible
 * 5. All actual shape rendering happens in the main canvas (canvas.tsx)
 *
 * IMPORTANT: This is NOT a full React Flow canvas implementation.
 * - Canvas elements are managed by Zustand store (lib/store.ts)
 * - Shapes are rendered as SVG in canvas.tsx
 * - This component ONLY renders the connection lines between shapes
 * - All AI tools create canvas elements, not React Flow nodes
 *
 * @see /components/editor/canvas.tsx - Main SVG canvas (shapes rendered here)
 * @see /lib/types.ts - CanvasElement and SmartConnection types
 * @see /lib/store.ts - Zustand state management
 * @see /app/workflow/page.tsx - Disabled React Flow canvas (different system)
 */

import type React from "react"

import { useMemo, useCallback, forwardRef, useImperativeHandle, memo } from "react"
import {
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  type Edge,
  type Node,
  type EdgeProps,
  type NodeProps,
  MarkerType,
  ConnectionMode,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type { CanvasElement, SmartConnection, Viewport, HandlePosition } from "@/lib/types"
import { getSolidStrokeColor } from "@/lib/canvas-helpers"

/**
 * InvisibleNode - Transparent React Flow node used only for connection anchoring
 *
 * These nodes are positioned at canvas element locations but remain invisible.
 * They provide handle points for React Flow edges to connect to.
 */
interface InvisibleNodeData extends Record<string, unknown> {
  width: number
  height: number
}

const InvisibleNode = memo(function InvisibleNode({ data }: NodeProps<Node<InvisibleNodeData>>) {
  const { width, height } = data
  
  return (
    <div 
      style={{ 
        width, 
        height, 
        background: "transparent",
        position: "relative",
      }}
    >
      {/* Handle at top center */}
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        style={{ 
          opacity: 0, 
          width: 1, 
          height: 1,
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          pointerEvents: "none",
        }}
      />
      {/* Handle at bottom center */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={{ 
          opacity: 0, 
          width: 1, 
          height: 1,
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          pointerEvents: "none",
        }}
      />
      {/* Handle at left center */}
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        style={{ 
          opacity: 0, 
          width: 1, 
          height: 1,
          left: 0,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
        }}
      />
      {/* Handle at right center */}
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={{ 
          opacity: 0, 
          width: 1, 
          height: 1,
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
        }}
      />
    </div>
  )
})

// Custom edge component with styling support
function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  markerStart,
  selected,
}: EdgeProps) {
  const edgeData = data as { pathType?: string; strokeColor?: string; strokeWidth?: number; strokeStyle?: string; animated?: boolean; label?: string } | undefined
  const pathType = edgeData?.pathType || "smoothstep"
  const strokeColor = edgeData?.strokeColor || "#6366f1"
  const strokeWidth = edgeData?.strokeWidth || 2
  const strokeStyle = edgeData?.strokeStyle || "solid"
  const animated = edgeData?.animated || false
  const label = edgeData?.label

  let edgePath: string
  let labelX: number
  let labelY: number

  if (pathType === "bezier") {
    ;[edgePath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    })
  } else if (pathType === "straight") {
    ;[edgePath, labelX, labelY] = getStraightPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
    })
  } else {
    ;[edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: 8,
    })
  }

  const strokeDasharray = strokeStyle === "dashed" ? "8 4" : strokeStyle === "dotted" ? "2 4" : undefined

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={{
          stroke: strokeColor,
          strokeWidth: selected ? strokeWidth + 1 : strokeWidth,
          strokeDasharray,
        }}
        className={animated ? "animated-edge" : ""}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="px-2 py-1 text-xs bg-background border border-border rounded shadow-sm"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const edgeTypes = {
  custom: CustomEdge,
}

const nodeTypes = {
  invisible: InvisibleNode,
}

// Map handle position to React Flow position
function _mapHandlePosition(pos?: HandlePosition) {
  switch (pos) {
    case "top":
      return "top"
    case "bottom":
      return "bottom"
    case "left":
      return "left"
    case "right":
      return "right"
    default:
      return "bottom"
  }
}

// Get anchor point on element edge based on handle position
function _getAnchorPoint(element: CanvasElement, handle: HandlePosition): { x: number; y: number } {
  const centerX = element.x + element.width / 2
  const centerY = element.y + element.height / 2

  switch (handle) {
    case "top":
      return { x: centerX, y: element.y }
    case "bottom":
      return { x: centerX, y: element.y + element.height }
    case "left":
      return { x: element.x, y: centerY }
    case "right":
      return { x: element.x + element.width, y: centerY }
    default:
      return { x: centerX, y: centerY }
  }
}

// Auto-determine best handle positions based on relative positions
function autoHandlePositions(
  source: CanvasElement,
  target: CanvasElement,
): { sourceHandle: HandlePosition; targetHandle: HandlePosition } {
  const sourceCenterX = source.x + source.width / 2
  const sourceCenterY = source.y + source.height / 2
  const targetCenterX = target.x + target.width / 2
  const targetCenterY = target.y + target.height / 2

  const dx = targetCenterX - sourceCenterX
  const dy = targetCenterY - sourceCenterY

  // Determine primary direction
  if (Math.abs(dy) > Math.abs(dx)) {
    // Vertical connection
    if (dy > 0) {
      return { sourceHandle: "bottom", targetHandle: "top" }
    } else {
      return { sourceHandle: "top", targetHandle: "bottom" }
    }
  } else {
    // Horizontal connection
    if (dx > 0) {
      return { sourceHandle: "right", targetHandle: "left" }
    } else {
      return { sourceHandle: "left", targetHandle: "right" }
    }
  }
}

interface SmartConnectorLayerProps {
  elements: CanvasElement[]
  connections: SmartConnection[]
  viewport: Viewport
  onConnectionsChange?: (connections: SmartConnection[]) => void
  onConnectionSelect?: (connectionId: string | null) => void
  selectedConnectionId?: string | null
  isDarkMode?: boolean
}

export interface SmartConnectorLayerHandle {
  addConnection: (connection: SmartConnection) => void
  removeConnection: (connectionId: string) => void
  updateConnection: (connectionId: string, updates: Partial<SmartConnection>) => void
  getConnections: () => SmartConnection[]
}

export const SmartConnectorLayer = forwardRef<SmartConnectorLayerHandle, SmartConnectorLayerProps>(
  function SmartConnectorLayer(
    {
      elements,
      connections,
      viewport,
      onConnectionsChange,
      onConnectionSelect,
      selectedConnectionId,
      isDarkMode = false,
    },
    ref,
  ) {
    // Convert canvas elements to React Flow nodes (invisible, just for positioning)
    // Uses custom InvisibleNode type with handles at all 4 positions (top/right/bottom/left)
    const nodes: Node<InvisibleNodeData>[] = useMemo(() => {
      return elements
        .filter((el) => el.type !== "arrow" && el.type !== "line" && el.type !== "freedraw")
        .map((el) => ({
          id: el.id,
          type: "invisible", // Custom node type with handles
          position: { x: el.x, y: el.y },
          data: { width: el.width, height: el.height },
          selectable: false,
          draggable: false,
        }))
    }, [elements])

    // Convert smart connections to React Flow edges
    const edges: Edge[] = useMemo(() => {
      return connections.map((conn) => {
        const sourceEl = elements.find((el) => el.id === conn.sourceId)
        const targetEl = elements.find((el) => el.id === conn.targetId)

        // Auto-determine handle positions if not specified
        let sourceHandle = conn.sourceHandle
        let targetHandle = conn.targetHandle

        if (sourceEl && targetEl && (!sourceHandle || !targetHandle)) {
          const autoHandles = autoHandlePositions(sourceEl, targetEl)
          sourceHandle = sourceHandle || autoHandles.sourceHandle
          targetHandle = targetHandle || autoHandles.targetHandle
        }

        return {
          id: conn.id,
          source: conn.sourceId,
          target: conn.targetId,
          sourceHandle: sourceHandle,
          targetHandle: targetHandle,
          type: "custom",
          selected: conn.id === selectedConnectionId,
          markerEnd:
            conn.arrowHeadEnd !== "none"
              ? {
                type: MarkerType.ArrowClosed,
                color: conn.strokeColor ? getSolidStrokeColor(conn.strokeColor) : (isDarkMode ? "#ffffff" : "#6366f1"),
              }
              : undefined,
          markerStart:
            conn.arrowHeadStart && conn.arrowHeadStart !== "none"
              ? {
                type: MarkerType.ArrowClosed,
                color: conn.strokeColor ? getSolidStrokeColor(conn.strokeColor) : (isDarkMode ? "#ffffff" : "#6366f1"),
              }
              : undefined,
          data: {
            pathType: conn.pathType || "smoothstep",
            strokeColor: conn.strokeColor ? getSolidStrokeColor(conn.strokeColor) : (isDarkMode ? "#ffffff" : "#6366f1"),
            strokeWidth: conn.strokeWidth || 2,
            strokeStyle: conn.strokeStyle || "solid",
            animated: conn.animated || false,
            label: conn.label,
          },
        }
      })
    }, [connections, elements, selectedConnectionId, isDarkMode])

    useImperativeHandle(ref, () => ({
      addConnection: (connection: SmartConnection) => {
        onConnectionsChange?.([...connections, connection])
      },
      removeConnection: (connectionId: string) => {
        onConnectionsChange?.(connections.filter((c) => c.id !== connectionId))
      },
      updateConnection: (connectionId: string, updates: Partial<SmartConnection>) => {
        onConnectionsChange?.(connections.map((c) => (c.id === connectionId ? { ...c, ...updates } : c)))
      },
      getConnections: () => connections,
    }))

    const onEdgeClick = useCallback(
      (_: React.MouseEvent, edge: Edge) => {
        onConnectionSelect?.(edge.id)
      },
      [onConnectionSelect],
    )

    const onPaneClick = useCallback(() => {
      onConnectionSelect?.(null)
    }, [onConnectionSelect])

    return (
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          transform: `translate(${viewport.x * viewport.zoom}px, ${viewport.y * viewport.zoom}px) scale(${viewport.zoom})`,
          transformOrigin: "0 0",
          zIndex: 2, // Render on top of canvas elements (which have zIndex: 1)
        }}
      >
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            connectionMode={ConnectionMode.Loose}
            fitView={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            selectNodesOnDrag={false}
            proOptions={{ hideAttribution: true }}
            style={{
              background: "transparent",
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
            className="!bg-transparent [&_.react-flow__edge]:pointer-events-auto"
          />
        </ReactFlowProvider>
      </div>
    )
  },
)
