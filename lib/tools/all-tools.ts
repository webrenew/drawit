/**
 * Combined export of all AI tools
 */

import { canvasTools } from "./canvas-tools"
import { diagramTools } from "./diagram-tools"
import { shapeTools } from "./shape-tools"
import { styleTools } from "./style-tools"

export const allTools = {
  ...canvasTools,
  ...diagramTools,
  ...shapeTools,
  ...styleTools,
}

// Type for tool names
export type ToolName = keyof typeof allTools

