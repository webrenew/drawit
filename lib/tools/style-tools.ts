/**
 * Style manipulation tools for updating colors and visual properties
 */

import { tool } from "ai"
import { updateStylesSchema } from "./schemas"

export const styleTools = {
  updateStyles: tool({
    description:
      "Update colors and styles on existing elements without recreating the diagram. Use this when the user wants to change colors, stroke widths, or other visual properties.",
    parameters: updateStylesSchema,
  }),
}

