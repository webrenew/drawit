/**
 * Canvas-level tools for reading state, clearing, analyzing, and beautifying
 */

import { tool } from "ai"
import { z } from "zod"
import { toolOutputSchema } from "./schemas"

export const canvasTools = {
  getCanvasState: tool({
    description: "Get the current state of the canvas including all shapes and connections. Call this FIRST.",
    parameters: z.object({}),
  }),

  clearCanvas: tool({
    description: "Clear all shapes and connections from the canvas.",
    parameters: z.object({}),
  }),

  analyzeDiagram: tool({
    description: "Analyze the current diagram and provide insights.",
    parameters: z.object({}),
  }),

  beautifyDiagram: tool({
    description: "Automatically arrange and beautify the current diagram layout.",
    parameters: z.object({}),
  }),
}

