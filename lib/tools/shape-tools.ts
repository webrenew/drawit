/**
 * Individual shape manipulation tools
 * AI SDK v6 - uses inputSchema instead of parameters
 */

import { tool } from "ai"
import {
  createShapeSchema,
  updateShapeSchema,
  getShapeInfoSchema,
  placeImageSchema,
  previewDiagramSchema,
} from "./schemas"

export const shapeTools = {
  createShape: tool({
    description: "Create a basic shape on the canvas.",
    inputSchema: createShapeSchema,
  }),

  updateShape: tool({
    description: "Update an existing shape's properties.",
    inputSchema: updateShapeSchema,
  }),

  getShapeInfo: tool({
    description: "Get information about a specific shape.",
    inputSchema: getShapeInfoSchema,
  }),

  placeImage: tool({
    description: "Place an image on the canvas.",
    inputSchema: placeImageSchema,
  }),

  previewDiagram: tool({
    description: "Preview changes before applying them.",
    inputSchema: previewDiagramSchema,
  }),
}

