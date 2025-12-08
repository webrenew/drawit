/**
 * Individual shape manipulation tools
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
    parameters: createShapeSchema,
  }),

  updateShape: tool({
    description: "Update an existing shape's properties.",
    parameters: updateShapeSchema,
  }),

  getShapeInfo: tool({
    description: "Get information about a specific shape.",
    parameters: getShapeInfoSchema,
  }),

  placeImage: tool({
    description: "Place an image on the canvas.",
    parameters: placeImageSchema,
  }),

  previewDiagram: tool({
    description: "Preview changes before applying them.",
    parameters: previewDiagramSchema,
  }),
}

