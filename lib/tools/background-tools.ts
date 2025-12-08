/**
 * Background Tools - For complex operations that need longer execution time
 * 
 * These tools trigger Trigger.dev background tasks for:
 * - Complex multi-node diagrams
 * - Large data transformations
 * - Operations that may take > 30 seconds
 */

import { tool } from "ai"
import { z } from "zod"

const runBackgroundDiagramSchema = z.object({
  prompt: z.string().describe("The full diagram request to process in the background"),
  diagramType: z.enum(["flowchart", "network", "mindmap", "orgchart", "general"]).describe("The type of diagram to create"),
  complexity: z.enum(["high", "very_high"]).describe("Complexity level - high (10-20 nodes) or very_high (20+ nodes)"),
})

export const backgroundTools = {
  /**
   * Run a complex diagram generation in the background via Trigger.dev
   * Use when: Creating diagrams with 10+ nodes or complex relationships
   */
  runBackgroundDiagram: tool({
    description: `Run complex diagram generation as a background task. Use this when:
- User requests a diagram with 10+ nodes
- User asks for "detailed", "comprehensive", or "complete" diagrams
- Request involves complex relationships or multiple interconnected systems
- You estimate the diagram will have many elements

The task runs server-side with more time and resources. Results are applied to the canvas automatically.`,
    parameters: runBackgroundDiagramSchema,
  }),
}

export type RunBackgroundDiagramArgs = z.infer<typeof runBackgroundDiagramSchema>
