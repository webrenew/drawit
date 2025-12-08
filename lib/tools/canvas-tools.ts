/**
 * Canvas-level tools for reading state, clearing, analyzing, and beautifying
 * AI SDK v6 - uses inputSchema instead of parameters
 */

import { tool } from "ai"
import { z } from "zod"

export const canvasTools = {
  getCanvasState: tool({
    description: "Get the current state of the canvas including all shapes and connections. Call this FIRST.",
    inputSchema: z.object({}),
  }),

  clearCanvas: tool({
    description: "Clear all shapes and connections from the canvas.",
    inputSchema: z.object({}),
  }),

  analyzeDiagram: tool({
    description: "Analyze the current diagram and provide insights.",
    inputSchema: z.object({}),
  }),

  beautifyDiagram: tool({
    description: "Automatically arrange and beautify the current diagram layout.",
    inputSchema: z.object({}),
  }),
}

