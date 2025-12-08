/**
 * Diagram creation tools - flowcharts, workflows, mind maps, org charts, etc.
 * AI SDK v6 - uses inputSchema instead of parameters
 */

import { tool } from "ai"
import {
  createFlowchartSchema,
  createWorkflowSchema,
  createMindMapSchema,
  createOrgChartSchema,
  createERDiagramSchema,
  createNetworkDiagramSchema,
  createMoleculeSchema,
} from "./schemas"

export const diagramTools = {
  createFlowchart: tool({
    description: "Create a flowchart with connected nodes. Supports per-node colors for visual distinction.",
    inputSchema: createFlowchartSchema,
  }),

  createWorkflow: tool({
    description: "Create n8n-style workflow automation diagrams.",
    inputSchema: createWorkflowSchema,
  }),

  createMindMap: tool({
    description: "Create a mind map for brainstorming and idea organization.",
    inputSchema: createMindMapSchema,
  }),

  createOrgChart: tool({
    description: "Create an organizational chart showing team hierarchy.",
    inputSchema: createOrgChartSchema,
  }),

  createERDiagram: tool({
    description: "Create an entity-relationship diagram for database design.",
    inputSchema: createERDiagramSchema,
  }),

  createNetworkDiagram: tool({
    description: "Create a network/architecture diagram showing how systems connect. Supports per-node colors.",
    inputSchema: createNetworkDiagramSchema,
  }),

  createMolecule: tool({
    description: "Create a molecular structure diagram. Supports common molecules like H2O, CO2, CH4, etc.",
    inputSchema: createMoleculeSchema,
  }),
}
