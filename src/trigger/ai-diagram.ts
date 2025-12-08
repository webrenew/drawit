/**
 * AI Diagram Generation Task - Trigger.dev
 * 
 * Server-side AI tool execution using Trigger.dev for:
 * - Better reliability (retries, timeouts)
 * - Longer execution time (up to 5 mins)
 * - Server-side tool execution
 * - Progress streaming back to client
 */

import { logger, task, metadata } from "@trigger.dev/sdk/v3"
import { generateText, tool } from "ai"
import { gateway } from "@ai-sdk/gateway"
import { z } from "zod"
import { createClient } from "@supabase/supabase-js"

// ============================================
// Types
// ============================================

interface DiagramNode {
  id: string
  type: string
  label: string
  x?: number
  y?: number
  width?: number
  height?: number
  strokeColor?: string
  backgroundColor?: string
}

interface DiagramConnection {
  from: string
  to: string
  label?: string
}

interface DiagramResult {
  elements: DiagramNode[]
  connections: DiagramConnection[]
  summary: string
}

interface CanvasInfo {
  centerX: number
  centerY: number
  width: number
  height: number
}

// ============================================
// Tool Schemas (Server-side)
// ============================================

const createFlowchartSchema = z.object({
  steps: z.array(z.object({
    id: z.string(),
    type: z.enum(["start", "end", "process", "decision", "data", "document"]),
    label: z.string(),
    strokeColor: z.string().optional(),
    backgroundColor: z.string().optional(),
  })),
  connections: z.array(z.object({
    from: z.string(),
    to: z.string(),
    label: z.string().optional(),
  })),
  direction: z.enum(["vertical", "horizontal"]).optional(),
})

const createNetworkDiagramSchema = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    type: z.enum(["server", "database", "client", "router", "firewall", "cloud", "service"]),
    label: z.string(),
    strokeColor: z.string().optional(),
    backgroundColor: z.string().optional(),
  })),
  links: z.array(z.object({
    from: z.string(),
    to: z.string(),
    label: z.string().optional(),
  })),
  topology: z.enum(["star", "ring", "mesh", "tree", "bus"]),
  centerNodeId: z.string().optional(),
  rootNodeId: z.string().optional(),
})

const createMindMapSchema = z.object({
  centralTopic: z.string(),
  branches: z.array(z.object({
    id: z.string(),
    label: z.string(),
    children: z.array(z.string()).optional(),
  })),
})

const createOrgChartSchema = z.object({
  members: z.array(z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
    reportsTo: z.string().optional(),
  })),
})

// ============================================
// Layout Helpers
// ============================================

function layoutFlowchart(
  steps: z.infer<typeof createFlowchartSchema>["steps"],
  connections: z.infer<typeof createFlowchartSchema>["connections"],
  canvasInfo: CanvasInfo,
  direction: "vertical" | "horizontal" = "vertical"
): { elements: DiagramNode[]; connections: DiagramConnection[] } {
  const nodeWidth = 160
  const nodeHeight = 60
  const spacing = direction === "vertical" ? 100 : 120

  // Build adjacency list and find start nodes
  const adjacency = new Map<string, string[]>()
  const inDegree = new Map<string, number>()
  
  steps.forEach(step => {
    adjacency.set(step.id, [])
    inDegree.set(step.id, 0)
  })
  
  connections.forEach(conn => {
    adjacency.get(conn.from)?.push(conn.to)
    inDegree.set(conn.to, (inDegree.get(conn.to) || 0) + 1)
  })

  // Topological sort for layering
  const layers: string[][] = []
  const queue = steps.filter(s => (inDegree.get(s.id) || 0) === 0).map(s => s.id)
  const visited = new Set<string>()

  while (queue.length > 0) {
    const layer: string[] = []
    const nextQueue: string[] = []
    
    for (const nodeId of queue) {
      if (visited.has(nodeId)) continue
      visited.add(nodeId)
      layer.push(nodeId)
      
      for (const neighbor of adjacency.get(nodeId) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1
        inDegree.set(neighbor, newDegree)
        if (newDegree === 0) {
          nextQueue.push(neighbor)
        }
      }
    }
    
    if (layer.length > 0) layers.push(layer)
    queue.length = 0
    queue.push(...nextQueue)
  }

  // Add any unvisited nodes
  steps.forEach(step => {
    if (!visited.has(step.id)) {
      layers.push([step.id])
      visited.add(step.id)
    }
  })

  // Calculate positions
  const totalWidth = direction === "vertical" 
    ? Math.max(...layers.map(l => l.length)) * (nodeWidth + spacing)
    : layers.length * (nodeWidth + spacing)
  const totalHeight = direction === "vertical"
    ? layers.length * (nodeHeight + spacing)
    : Math.max(...layers.map(l => l.length)) * (nodeHeight + spacing)

  const startX = canvasInfo.centerX - totalWidth / 2
  const startY = canvasInfo.centerY - totalHeight / 2

  const stepMap = new Map(steps.map(s => [s.id, s]))
  const elements: DiagramNode[] = []

  layers.forEach((layer, layerIndex) => {
    layer.forEach((nodeId, nodeIndex) => {
      const step = stepMap.get(nodeId)
      if (!step) return

      const x = direction === "vertical"
        ? startX + nodeIndex * (nodeWidth + spacing) + (layers.length > 1 ? (Math.max(...layers.map(l => l.length)) - layer.length) * (nodeWidth + spacing) / 2 : 0)
        : startX + layerIndex * (nodeWidth + spacing)
      const y = direction === "vertical"
        ? startY + layerIndex * (nodeHeight + spacing)
        : startY + nodeIndex * (nodeHeight + spacing) + (layers.length > 1 ? (Math.max(...layers.map(l => l.length)) - layer.length) * (nodeHeight + spacing) / 2 : 0)

      elements.push({
        id: step.id,
        type: step.type,
        label: step.label,
        x,
        y,
        width: nodeWidth,
        height: nodeHeight,
        strokeColor: step.strokeColor,
        backgroundColor: step.backgroundColor,
      })
    })
  })

  return { elements, connections }
}

function layoutNetwork(
  nodes: z.infer<typeof createNetworkDiagramSchema>["nodes"],
  links: z.infer<typeof createNetworkDiagramSchema>["links"],
  topology: string,
  canvasInfo: CanvasInfo,
  centerNodeId?: string,
  _rootNodeId?: string
): { elements: DiagramNode[]; connections: DiagramConnection[] } {
  const nodeWidth = 120
  const nodeHeight = 80
  const radius = Math.min(canvasInfo.width, canvasInfo.height) / 3

  const elements: DiagramNode[] = nodes.map((node, index) => {
    let x = canvasInfo.centerX
    let y = canvasInfo.centerY

    if (topology === "star") {
      if (node.id === centerNodeId) {
        x = canvasInfo.centerX
        y = canvasInfo.centerY
      } else {
        const otherNodes = nodes.filter(n => n.id !== centerNodeId)
        const nodeIndex = otherNodes.findIndex(n => n.id === node.id)
        const angle = (2 * Math.PI * nodeIndex) / otherNodes.length
        x = canvasInfo.centerX + radius * Math.cos(angle)
        y = canvasInfo.centerY + radius * Math.sin(angle)
      }
    } else if (topology === "ring") {
      const angle = (2 * Math.PI * index) / nodes.length
      x = canvasInfo.centerX + radius * Math.cos(angle)
      y = canvasInfo.centerY + radius * Math.sin(angle)
    } else if (topology === "mesh") {
      const cols = Math.ceil(Math.sqrt(nodes.length))
      const row = Math.floor(index / cols)
      const col = index % cols
      x = canvasInfo.centerX - (cols * nodeWidth) / 2 + col * (nodeWidth + 60) + nodeWidth / 2
      y = canvasInfo.centerY - (Math.ceil(nodes.length / cols) * nodeHeight) / 2 + row * (nodeHeight + 60) + nodeHeight / 2
    } else if (topology === "tree") {
      // Simple tree layout
      x = canvasInfo.centerX + (index % 3 - 1) * 180
      y = canvasInfo.centerY - 200 + Math.floor(index / 3) * 120
    } else if (topology === "bus") {
      x = canvasInfo.centerX - (nodes.length * nodeWidth) / 2 + index * (nodeWidth + 40) + nodeWidth / 2
      y = canvasInfo.centerY
    }

    return {
      id: node.id,
      type: node.type,
      label: node.label,
      x,
      y,
      width: nodeWidth,
      height: nodeHeight,
      strokeColor: node.strokeColor,
      backgroundColor: node.backgroundColor,
    }
  })

  return { elements, connections: links }
}

function layoutMindMap(
  centralTopic: string,
  branches: z.infer<typeof createMindMapSchema>["branches"],
  canvasInfo: CanvasInfo
): { elements: DiagramNode[]; connections: DiagramConnection[] } {
  const elements: DiagramNode[] = []
  const connections: DiagramConnection[] = []
  
  // Central node
  elements.push({
    id: "central",
    type: "ellipse",
    label: centralTopic,
    x: canvasInfo.centerX,
    y: canvasInfo.centerY,
    width: 180,
    height: 80,
    backgroundColor: "#4a90d9",
  })

  // Branch nodes
  const radius = 250
  branches.forEach((branch, index) => {
    const angle = (2 * Math.PI * index) / branches.length - Math.PI / 2
    const x = canvasInfo.centerX + radius * Math.cos(angle)
    const y = canvasInfo.centerY + radius * Math.sin(angle)

    elements.push({
      id: branch.id,
      type: "rectangle",
      label: branch.label,
      x,
      y,
      width: 140,
      height: 50,
    })

    connections.push({
      from: "central",
      to: branch.id,
    })

    // Children
    if (branch.children) {
      const childRadius = 120
      branch.children.forEach((childLabel, childIndex) => {
        const childAngle = angle + (childIndex - (branch.children!.length - 1) / 2) * 0.3
        const childX = x + childRadius * Math.cos(childAngle)
        const childY = y + childRadius * Math.sin(childAngle)
        const childId = `${branch.id}-child-${childIndex}`

        elements.push({
          id: childId,
          type: "rectangle",
          label: childLabel,
          x: childX,
          y: childY,
          width: 100,
          height: 40,
        })

        connections.push({
          from: branch.id,
          to: childId,
        })
      })
    }
  })

  return { elements, connections }
}

function layoutOrgChart(
  members: z.infer<typeof createOrgChartSchema>["members"],
  canvasInfo: CanvasInfo
): { elements: DiagramNode[]; connections: DiagramConnection[] } {
  const elements: DiagramNode[] = []
  const connections: DiagramConnection[] = []
  
  // Build hierarchy
  const memberMap = new Map(members.map(m => [m.id, m]))
  const children = new Map<string | null, typeof members>()
  
  members.forEach(m => {
    const parent = m.reportsTo || null
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent)!.push(m)
  })

  // Layout by levels
  const levels: string[][] = []
  let currentLevel = children.get(null) || []
  
  while (currentLevel.length > 0) {
    levels.push(currentLevel.map(m => m.id))
    const nextLevel: typeof members = []
    currentLevel.forEach(m => {
      const memberChildren = children.get(m.id) || []
      nextLevel.push(...memberChildren)
    })
    currentLevel = nextLevel
  }

  const nodeWidth = 150
  const nodeHeight = 70
  const horizontalSpacing = 40
  const verticalSpacing = 80

  levels.forEach((level, levelIndex) => {
    const totalWidth = level.length * nodeWidth + (level.length - 1) * horizontalSpacing
    const startX = canvasInfo.centerX - totalWidth / 2

    level.forEach((memberId, memberIndex) => {
      const member = memberMap.get(memberId)!
      const x = startX + memberIndex * (nodeWidth + horizontalSpacing)
      const y = canvasInfo.centerY - (levels.length * (nodeHeight + verticalSpacing)) / 2 + levelIndex * (nodeHeight + verticalSpacing)

      elements.push({
        id: member.id,
        type: "rectangle",
        label: `${member.name}\n${member.role}`,
        x,
        y,
        width: nodeWidth,
        height: nodeHeight,
      })

      if (member.reportsTo) {
        connections.push({
          from: member.reportsTo,
          to: member.id,
        })
      }
    })
  })

  return { elements, connections }
}

// ============================================
// System Prompt
// ============================================

function getSystemPrompt(canvasInfo: CanvasInfo, theme: string) {
  return `You are an expert diagram assistant. Create diagrams based on user requests.

CANVAS INFO:
- Center: (${canvasInfo.centerX}, ${canvasInfo.centerY})
- Dimensions: ${canvasInfo.width}x${canvasInfo.height}
- Theme: ${theme}

RULES:
1. ALWAYS create connections between related nodes
2. Use different colors for different node types when requested
3. Keep labels concise but descriptive
4. Create complete, professional diagrams

Available tools:
- createFlowchart: For process flows, decision trees
- createNetworkDiagram: For architecture, infrastructure
- createMindMap: For brainstorming, idea organization
- createOrgChart: For team hierarchies

Choose the most appropriate tool for the request.`
}

// ============================================
// Supabase Client
// ============================================

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!url || !key) {
    throw new Error("Supabase credentials not configured")
  }
  
  return createClient(url, key)
}

// ============================================
// Main Task
// ============================================

export const aiDiagramTask = task({
  id: "ai-diagram-generation",
  maxDuration: 300, // 5 minutes max
  retry: {
    maxAttempts: 2,
  },
  run: async (payload: {
    prompt: string
    canvasInfo: CanvasInfo
    theme: string
    userId: string
    diagramId?: string
    model?: string
  }) => {
    const { prompt, canvasInfo, theme, userId, diagramId, model = "anthropic/claude-opus-4.5" } = payload
    
    logger.info("Starting AI diagram generation", { prompt, userId, model })
    metadata.set("userId", userId)
    metadata.set("prompt", prompt.substring(0, 100))

    let result: DiagramResult = {
      elements: [],
      connections: [],
      summary: "",
    }

    try {
      const aiResult = await generateText({
        model: gateway(model),
        system: getSystemPrompt(canvasInfo, theme),
        prompt,
        tools: {
          createFlowchart: tool({
            description: "Create a flowchart with connected nodes",
            parameters: createFlowchartSchema,
            execute: async (args) => {
              logger.info("Creating flowchart", { stepsCount: args.steps.length })
              const layout = layoutFlowchart(args.steps, args.connections, canvasInfo, args.direction)
              result.elements = layout.elements
              result.connections = layout.connections
              return JSON.stringify({ success: true, elementsCreated: layout.elements.length })
            },
          }),
          createNetworkDiagram: tool({
            description: "Create a network/architecture diagram",
            parameters: createNetworkDiagramSchema,
            execute: async (args) => {
              logger.info("Creating network diagram", { nodesCount: args.nodes.length, topology: args.topology })
              const layout = layoutNetwork(args.nodes, args.links, args.topology, canvasInfo, args.centerNodeId, args.rootNodeId)
              result.elements = layout.elements
              result.connections = layout.connections
              return JSON.stringify({ success: true, elementsCreated: layout.elements.length })
            },
          }),
          createMindMap: tool({
            description: "Create a mind map for brainstorming",
            parameters: createMindMapSchema,
            execute: async (args) => {
              logger.info("Creating mind map", { branchesCount: args.branches.length })
              const layout = layoutMindMap(args.centralTopic, args.branches, canvasInfo)
              result.elements = layout.elements
              result.connections = layout.connections
              return JSON.stringify({ success: true, elementsCreated: layout.elements.length })
            },
          }),
          createOrgChart: tool({
            description: "Create an organizational chart",
            parameters: createOrgChartSchema,
            execute: async (args) => {
              logger.info("Creating org chart", { membersCount: args.members.length })
              const layout = layoutOrgChart(args.members, canvasInfo)
              result.elements = layout.elements
              result.connections = layout.connections
              return JSON.stringify({ success: true, elementsCreated: layout.elements.length })
            },
          }),
        },
        maxSteps: 3,
      })

      result.summary = aiResult.text || "Diagram created successfully"
      
      logger.info("AI diagram generation complete", { 
        elementsCount: result.elements.length,
        connectionsCount: result.connections.length,
      })

      // Save to Supabase if diagramId provided
      if (diagramId) {
        try {
          const supabase = getSupabaseClient()
          await supabase
            .from("diagrams")
            .update({
              elements: result.elements,
              connections: result.connections,
              updated_at: new Date().toISOString(),
            })
            .eq("id", diagramId)
            .eq("user_id", userId)
          
          logger.info("Saved diagram to Supabase", { diagramId })
        } catch (dbError) {
          logger.error("Failed to save to Supabase", { error: dbError })
          // Don't fail the task, just log the error
        }
      }

      return result

    } catch (error) {
      logger.error("AI diagram generation failed", { error })
      throw error
    }
  },
})

// Export type for client usage
export type AIDiagramTaskPayload = Parameters<typeof aiDiagramTask.trigger>[0]
export type AIDiagramTaskResult = DiagramResult
