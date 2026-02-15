/**
 * Canvas State Serializer
 * Creates a clean n8n-style JSON representation of canvas state for AI agent context
 * This is automatically included in every request so the agent knows what's on the canvas
 */

import type { CanvasElement, SmartConnection } from "@/lib/types"

/**
 * n8n-style node representation
 * Clean, flat structure optimized for AI understanding
 */
export interface CanvasNode {
  id: string
  type: string
  label: string
  position: [number, number]  // [x, y]
  size: [number, number]      // [width, height]
  style?: {
    stroke?: string
    fill?: string
  }
}

/**
 * n8n-style edge representation
 * Simple source → target with optional label
 */
export interface CanvasEdge {
  id: string
  source: string
  target: string
  label?: string
}

/**
 * n8n-style canvas state JSON
 * Clean, structured format for AI to read and manipulate
 */
export interface CanvasStateJSON {
  /** Schema version for future compatibility */
  version: 1
  /** Summary statistics */
  meta: {
    nodeCount: number
    edgeCount: number
    bounds: {
      x: [number, number]  // [min, max]
      y: [number, number]  // [min, max]
    } | null
  }
  /** All nodes on canvas */
  nodes: CanvasNode[]
  /** All connections between nodes */
  edges: CanvasEdge[]
}

export type CanvasContextTruncationStrategy = "first" | "last"

export interface CanvasContextOptions {
  maxNodes?: number
  maxEdges?: number
  truncationStrategy?: CanvasContextTruncationStrategy
}

const DEFAULT_MAX_CONTEXT_NODES = parseContextLimit(process.env.AI_CHAT_CONTEXT_MAX_NODES, 25)
const DEFAULT_MAX_CONTEXT_EDGES = parseContextLimit(process.env.AI_CHAT_CONTEXT_MAX_EDGES, 20)

function parseContextLimit(rawValue: string | undefined, fallback: number): number {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback
  }
  return Math.floor(parsed)
}

function resolveContextLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback
  }
  return Math.floor(value)
}

function truncateItems<T>(items: T[], limit: number, strategy: CanvasContextTruncationStrategy): T[] {
  if (strategy === "last") {
    return items.slice(-limit)
  }
  return items.slice(0, limit)
}

/**
 * Convert canvas element to n8n-style node
 */
function toNode(el: CanvasElement): CanvasNode {
  const node: CanvasNode = {
    id: el.id,
    type: el.type,
    label: el.label || el.text || "",
    position: [Math.round(el.x), Math.round(el.y)],
    size: [Math.round(el.width), Math.round(el.height)],
  }

  // Only include style if non-default
  const hasStroke = el.strokeColor && typeof el.strokeColor === "string"
  const hasFill = el.backgroundColor && el.backgroundColor !== "transparent"
  
  if (hasStroke || hasFill) {
    node.style = {}
    if (hasStroke) node.style.stroke = el.strokeColor as string
    if (hasFill) node.style.fill = el.backgroundColor
  }

  return node
}

/**
 * Convert smart connection to n8n-style edge
 */
function toEdge(conn: SmartConnection): CanvasEdge {
  const edge: CanvasEdge = {
    id: conn.id,
    source: conn.sourceId,
    target: conn.targetId,
  }
  if (conn.label) edge.label = conn.label
  return edge
}

/**
 * Calculate bounds of all elements
 */
function calculateBounds(elements: CanvasElement[]): CanvasStateJSON["meta"]["bounds"] {
  if (elements.length === 0) return null

  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity

  for (const el of elements) {
    minX = Math.min(minX, el.x)
    maxX = Math.max(maxX, el.x + el.width)
    minY = Math.min(minY, el.y)
    maxY = Math.max(maxY, el.y + el.height)
  }

  return {
    x: [Math.round(minX), Math.round(maxX)],
    y: [Math.round(minY), Math.round(maxY)],
  }
}

/**
 * Serialize canvas state to n8n-style JSON
 */
export function serializeCanvasState(
  elements: CanvasElement[],
  connections: SmartConnection[]
): CanvasStateJSON {
  return {
    version: 1,
    meta: {
      nodeCount: elements.length,
      edgeCount: connections.length,
      bounds: calculateBounds(elements),
    },
    nodes: elements.map(toNode),
    edges: connections.map(toEdge),
  }
}

/**
 * Create JSON string for system prompt
 * Compact but readable format for AI context
 */
export function createCanvasContextString(
  elements: CanvasElement[],
  connections: SmartConnection[],
  options: CanvasContextOptions = {},
): string {
  if (elements.length === 0) {
    return `CURRENT CANVAS STATE:
\`\`\`json
{"version":1,"meta":{"nodeCount":0,"edgeCount":0,"bounds":null},"nodes":[],"edges":[]}
\`\`\`
Canvas is empty. Place new content at canvas center.`
  }

  const state = serializeCanvasState(elements, connections)
  const maxNodes = resolveContextLimit(options.maxNodes, DEFAULT_MAX_CONTEXT_NODES)
  const maxEdges = resolveContextLimit(options.maxEdges, DEFAULT_MAX_CONTEXT_EDGES)
  const truncationStrategy = options.truncationStrategy ?? "first"

  // Limit nodes/edges to avoid token bloat (configurable limits + strategy)
  const truncatedState: CanvasStateJSON = {
    ...state,
    nodes: truncateItems(state.nodes, maxNodes, truncationStrategy),
    edges: truncateItems(state.edges, maxEdges, truncationStrategy),
  }

  const truncationNote = elements.length > maxNodes || connections.length > maxEdges
    ? `\n(Showing ${truncatedState.nodes.length}/${elements.length} nodes, ${truncatedState.edges.length}/${connections.length} edges, strategy: ${truncationStrategy})`
    : ""

  // Pretty print with 2-space indent for readability
  const jsonStr = JSON.stringify(truncatedState, null, 2)

  return `CURRENT CANVAS STATE:
\`\`\`json
${jsonStr}
\`\`\`${truncationNote}

**Instructions:**
- Use existing \`id\` values when updating nodes
- Reference \`source\`/\`target\` IDs when creating edges
- New elements should use unique IDs (e.g., nanoid)
- Position new content relative to existing \`bounds\``
}

// Legacy exports for backwards compatibility
export type SerializedElement = CanvasNode
export type SerializedConnection = CanvasEdge
export type SerializedCanvasState = CanvasStateJSON
