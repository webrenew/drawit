/**
 * Dagre-based automatic layout for React Flow diagrams
 * Provides consistent, professional layouts for workflows and flowcharts
 */
import Dagre from "@dagrejs/dagre"
import type { Node, Edge } from "@xyflow/react"

export type LayoutDirection = "TB" | "LR" | "BT" | "RL"

export interface LayoutOptions {
  direction?: LayoutDirection
  nodeWidth?: number
  nodeHeight?: number
  rankSep?: number // Vertical spacing between ranks
  nodeSep?: number // Horizontal spacing between nodes in same rank
  edgeSep?: number // Spacing between edges
  marginX?: number // Horizontal margin
  marginY?: number // Vertical margin
}

const DEFAULT_OPTIONS: Required<LayoutOptions> = {
  direction: "TB",
  nodeWidth: 200,
  nodeHeight: 80,
  rankSep: 100,
  nodeSep: 50,
  edgeSep: 10,
  marginX: 50,
  marginY: 50,
}

/**
 * Apply Dagre layout to React Flow nodes and edges
 * Returns new nodes with updated positions
 */
export function layoutWithDagre<T extends Node>(nodes: T[], edges: Edge[], options: LayoutOptions = {}): T[] {
  if (nodes.length === 0) return nodes

  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Create a new Dagre graph
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))

  // Configure graph layout
  g.setGraph({
    rankdir: opts.direction,
    ranksep: opts.rankSep,
    nodesep: opts.nodeSep,
    edgesep: opts.edgeSep,
    marginx: opts.marginX,
    marginy: opts.marginY,
  })

  // Add nodes to the graph
  for (const node of nodes) {
    const width = node.measured?.width ?? opts.nodeWidth
    const height = node.measured?.height ?? opts.nodeHeight

    g.setNode(node.id, {
      width,
      height,
    })
  }

  // Add edges to the graph
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  // Run the layout algorithm
  Dagre.layout(g)

  // Map the computed positions back to React Flow nodes
  return nodes.map((node) => {
    const dagreNode = g.node(node.id)
    if (!dagreNode) return node

    // Dagre returns center positions, React Flow needs top-left
    const width = node.measured?.width ?? opts.nodeWidth
    const height = node.measured?.height ?? opts.nodeHeight

    return {
      ...node,
      position: {
        x: dagreNode.x - width / 2,
        y: dagreNode.y - height / 2,
      },
    }
  })
}

/**
 * Layout nodes and center the result on a given canvas position
 */
export function layoutAndCenter<T extends Node>(
  nodes: T[],
  edges: Edge[],
  centerX: number,
  centerY: number,
  options: LayoutOptions = {},
): T[] {
  if (nodes.length === 0) return nodes

  // First, apply the layout
  const layoutedNodes = layoutWithDagre(nodes, edges, options)

  // Calculate the bounding box of the layouted nodes
  const bounds = getNodesBounds(layoutedNodes)

  // Calculate offset to center the diagram
  const offsetX = centerX - (bounds.x + bounds.width / 2)
  const offsetY = centerY - (bounds.y + bounds.height / 2)

  // Apply the centering offset
  return layoutedNodes.map((node) => ({
    ...node,
    position: {
      x: node.position.x + offsetX,
      y: node.position.y + offsetY,
    },
  }))
}

/**
 * Get the bounding box of a set of nodes
 */
export function getNodesBounds(nodes: Node[]): {
  x: number
  y: number
  width: number
  height: number
} {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const node of nodes) {
    const width = node.measured?.width ?? 200
    const height = node.measured?.height ?? 80

    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + width)
    maxY = Math.max(maxY, node.position.y + height)
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/**
 * Detect overlapping nodes in the layout
 */
export function detectOverlaps(nodes: Node[]): Array<{ nodeA: string; nodeB: string }> {
  const overlaps: Array<{ nodeA: string; nodeB: string }> = []

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const nodeA = nodes[i]
      const nodeB = nodes[j]

      const widthA = nodeA.measured?.width ?? 200
      const heightA = nodeA.measured?.height ?? 80
      const widthB = nodeB.measured?.width ?? 200
      const heightB = nodeB.measured?.height ?? 80

      const aRight = nodeA.position.x + widthA
      const aBottom = nodeA.position.y + heightA
      const bRight = nodeB.position.x + widthB
      const bBottom = nodeB.position.y + heightB

      // Check for overlap
      if (
        nodeA.position.x < bRight &&
        aRight > nodeB.position.x &&
        nodeA.position.y < bBottom &&
        aBottom > nodeB.position.y
      ) {
        overlaps.push({ nodeA: nodeA.id, nodeB: nodeB.id })
      }
    }
  }

  return overlaps
}

/**
 * Analyze diagram layout quality
 */
export function analyzeLayoutQuality(
  nodes: Node[],
  edges: Edge[],
): {
  issues: string[]
  hasOverlaps: boolean
  hasPoorSpacing: boolean
  qualityScore: number
} {
  const issues: string[] = []
  const overlaps = detectOverlaps(nodes)

  if (overlaps.length > 0) {
    issues.push(
      `${overlaps.length} overlapping node pair(s) detected: ${overlaps.map((o) => `${o.nodeA}/${o.nodeB}`).join(", ")}`,
    )
  }

  // Check for very close nodes (poor spacing)
  const MIN_SPACING = 20
  let poorSpacingCount = 0

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const nodeA = nodes[i]
      const nodeB = nodes[j]

      const distance = Math.sqrt(
        Math.pow(nodeA.position.x - nodeB.position.x, 2) + Math.pow(nodeA.position.y - nodeB.position.y, 2),
      )

      if (distance < MIN_SPACING && distance > 0) {
        poorSpacingCount++
      }
    }
  }

  if (poorSpacingCount > 0) {
    issues.push(`${poorSpacingCount} node pair(s) have insufficient spacing`)
  }

  // Calculate quality score
  let qualityScore = 100
  qualityScore -= overlaps.length * 20 // -20 per overlap
  qualityScore -= poorSpacingCount * 5 // -5 per poor spacing
  qualityScore = Math.max(0, qualityScore)

  return {
    issues,
    hasOverlaps: overlaps.length > 0,
    hasPoorSpacing: poorSpacingCount > 0,
    qualityScore,
  }
}

/**
 * Re-layout with increased spacing to fix quality issues
 */
export function beautifyLayout<T extends Node>(nodes: T[], edges: Edge[], options: LayoutOptions = {}): T[] {
  // Increase spacing for beautification
  const beautifyOptions: LayoutOptions = {
    ...options,
    rankSep: (options.rankSep ?? DEFAULT_OPTIONS.rankSep) * 1.5,
    nodeSep: (options.nodeSep ?? DEFAULT_OPTIONS.nodeSep) * 1.5,
  }

  return layoutWithDagre(nodes, edges, beautifyOptions)
}
