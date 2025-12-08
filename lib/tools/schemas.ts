/**
 * Shared Zod schemas for tool inputs
 * Centralizes all schema definitions for reuse and consistency
 */

import { z } from "zod"

// ============================================
// Common schemas
// ============================================

export const colorSchema = z.string().optional().describe("Color value (hex, named, or rgb)")

export const nodeColorSchema = z.object({
  strokeColor: colorSchema.describe("Border color for this specific node"),
  backgroundColor: colorSchema.describe("Fill color for this specific node"),
})

export const colorSchemeSchema = z.object({
  strokeColor: colorSchema,
  backgroundColor: colorSchema,
  textColor: colorSchema,
}).optional().describe("Custom colors to use")

export const connectionSchema = z.object({
  from: z.string().describe("Source node ID"),
  to: z.string().describe("Target node ID"),
  label: z.string().optional().describe("Connection label"),
})

// ============================================
// Flowchart schemas
// ============================================

export const flowchartStepSchema = z.object({
  id: z.string(),
  type: z.enum(["start", "end", "process", "decision", "data", "document"]),
  label: z.string(),
  swimlane: z.string().optional(),
  strokeColor: colorSchema.describe("Border color for this specific node"),
  backgroundColor: colorSchema.describe("Fill color for this specific node"),
})

export const createFlowchartSchema = z.object({
  steps: z.array(flowchartStepSchema),
  connections: z.array(connectionSchema),
  direction: z.enum(["vertical", "horizontal"]).optional(),
  swimlanes: z.array(z.string()).optional(),
})

// ============================================
// Workflow schemas
// ============================================

export const workflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(["trigger", "action", "condition", "loop", "transform", "output"]),
  label: z.string(),
  description: z.string().optional(),
})

export const createWorkflowSchema = z.object({
  nodes: z.array(workflowNodeSchema),
  connections: z.array(connectionSchema),
  colorScheme: colorSchemeSchema,
})

// ============================================
// Mind map schemas
// ============================================

export const mindMapBranchSchema = z.object({
  id: z.string(),
  label: z.string(),
  children: z.array(z.string()).optional(),
})

export const createMindMapSchema = z.object({
  centralTopic: z.string(),
  branches: z.array(mindMapBranchSchema),
  colorScheme: colorSchemeSchema,
})

// ============================================
// Org chart schemas
// ============================================

export const orgMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  reportsTo: z.string().optional(),
})

export const createOrgChartSchema = z.object({
  members: z.array(orgMemberSchema),
  colorScheme: colorSchemeSchema,
})

// ============================================
// ER diagram schemas
// ============================================

export const entityAttributeSchema = z.object({
  name: z.string(),
  type: z.string(),
  isPrimaryKey: z.boolean().optional(),
  isForeignKey: z.boolean().optional(),
})

export const entitySchema = z.object({
  id: z.string(),
  name: z.string(),
  attributes: z.array(entityAttributeSchema),
})

export const relationshipSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(["one-to-one", "one-to-many", "many-to-many"]),
  label: z.string().optional(),
})

export const createERDiagramSchema = z.object({
  entities: z.array(entitySchema),
  relationships: z.array(relationshipSchema),
  colorScheme: colorSchemeSchema,
})

// ============================================
// Network diagram schemas
// ============================================

export const networkNodeSchema = z.object({
  id: z.string(),
  type: z.enum(["server", "database", "client", "router", "firewall", "cloud", "service"]),
  label: z.string(),
  strokeColor: colorSchema.describe("Border color for this specific node"),
  backgroundColor: colorSchema.describe("Fill color for this specific node"),
})

export const networkLinkSchema = z.object({
  from: z.string().describe("Source node ID"),
  to: z.string().describe("Target node ID"),
  label: z.string().optional(),
})

export const createNetworkDiagramSchema = z.object({
  nodes: z.array(networkNodeSchema),
  links: z.array(networkLinkSchema).describe("Connections between nodes - REQUIRED for showing relationships"),
  topology: z.enum(["star", "ring", "mesh", "tree", "bus"]).describe("Layout topology for the diagram"),
  centerNodeId: z.string().optional().describe("Required for star topology - the central node"),
  rootNodeId: z.string().optional().describe("Required for tree topology - the root node"),
})

// ============================================
// Molecule schema
// ============================================

export const createMoleculeSchema = z.object({
  formula: z.string().describe("Chemical formula like H2O, CO2, CH4, C6H12O6"),
  style: z.enum(["ball-and-stick", "space-filling"]).optional(),
})

// ============================================
// Shape schemas
// ============================================

export const createShapeSchema = z.object({
  type: z.enum(["rectangle", "circle", "diamond", "text", "arrow"]),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  label: z.string().optional(),
  color: z.string().optional(),
})

export const updateShapeSchema = z.object({
  id: z.string(),
  properties: z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    label: z.string().optional(),
    color: z.string().optional(),
  }),
})

export const getShapeInfoSchema = z.object({
  id: z.string(),
})

export const placeImageSchema = z.object({
  url: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
})

// ============================================
// Style schemas
// ============================================

export const updateStylesSchema = z.object({
  selector: z.enum(["all", "shapes", "connections", "byType", "byIds"]).describe("Which elements to update"),
  elementType: z.string().optional().describe("When selector is 'byType', specify: rectangle, ellipse, diamond, text, line, arrow"),
  elementIds: z.array(z.string()).optional().describe("When selector is 'byIds', list specific element IDs"),
  styles: z.object({
    strokeColor: colorSchema.describe("Border/outline color"),
    backgroundColor: colorSchema.describe("Fill color for shapes"),
    labelColor: colorSchema.describe("Text/label color"),
    strokeWidth: z.number().optional().describe("Border width in pixels"),
    opacity: z.number().optional().describe("Opacity from 0 to 100"),
  }),
})

// ============================================
// Preview/analyze schemas
// ============================================

export const previewDiagramSchema = z.object({
  action: z.string(),
  parameters: z.record(z.unknown()),
})

// Tool output schema
export const toolOutputSchema = z.string().describe("JSON string result of the tool execution")

