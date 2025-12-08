/**
 * AI Chat API Route - AI SDK v5 Stable
 * Uses Vercel AI Gateway for model access
 * Based on https://sdk.vercel.ai/docs/ai-sdk-ui/chatbot-tool-usage
 */

import type { UIMessage } from "ai"
import { streamText, tool, convertToModelMessages } from "ai"
import { z } from "zod"
import { gateway } from "@ai-sdk/gateway"

export const maxDuration = 60

const toolOutputSchema = z.string().describe("JSON string result of the tool execution")

// System prompt for the diagram assistant
function getSystemPrompt(
  theme: string,
  canvasInfo: { centerX: number; centerY: number; width: number; height: number },
) {
  return `You are an expert diagram and visualization assistant. You help users create various types of diagrams on a canvas.

CANVAS INFO:
- Center: (${canvasInfo.centerX}, ${canvasInfo.centerY})
- Dimensions: ${canvasInfo.width}x${canvasInfo.height}
- Theme: ${theme}

CAPABILITIES:
You can create:
- Flowcharts with connected nodes (start, end, process, decision, data, document)
- Workflow automations (n8n-style with triggers, actions, conditions)
- Mind maps for brainstorming
- Org charts for team structures
- ER diagrams for database design
- Network diagrams for infrastructure
- Molecular structures (H2O, CO2, etc.)
- Basic shapes (rectangles, circles, text, etc.)

COLORS:
- When the user specifies colors, YOU MUST use those exact colors on EACH NODE.
- Use strokeColor and backgroundColor on EACH individual node in the nodes array.
- Colors can be hex codes (#FF5733), named colors (red, blue), or rgb/hsl values.
- If user says "use blue, red, orange" etc., apply DIFFERENT colors to DIFFERENT nodes.

CONNECTIONS ARE CRITICAL:
- ALWAYS include connections/links between nodes to show relationships
- For createNetworkDiagram: include a "links" array with {from, to} for EVERY connection
- For createFlowchart: include a "connections" array with {from, to} for EVERY connection
- Diagrams without connections are incomplete and useless

WORKFLOW:
1. ALWAYS call getCanvasState first to see existing content
2. Use the appropriate tool to create the requested diagram
3. ALWAYS include connections/links between related nodes
4. Apply different colors to different nodes when user requests multiple colors
5. Provide a brief summary of what was created

When recreating from images:
- Analyze the image carefully
- Identify all nodes/shapes and their labels
- Identify all connections between nodes
- Recreate the layout as closely as possible

Be concise in your responses. Focus on creating accurate diagrams.`
}



export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { messages, canvasInfo, theme } = body as {
      messages: UIMessage[]
      canvasInfo?: { centerX: number; centerY: number; width: number; height: number }
      theme?: string
    }

    const selectedModelId = req.headers.get("x-selected-model") || "anthropic/claude-opus-4.5"

    // Default canvas info if not provided
    const canvas = canvasInfo || { centerX: 400, centerY: 300, width: 800, height: 600 }
    const currentTheme = theme || "dark"

    console.log("[v0] AI Chat request - model:", selectedModelId, "messages:", messages.length)

    // Use Vercel AI Gateway for all models
    const model = gateway(selectedModelId)

    const result = streamText({
      model: model,
      system: getSystemPrompt(currentTheme, canvas),
      messages: convertToModelMessages(messages),
      tools: {
        getCanvasState: tool({
          description: "Get the current state of the canvas including all shapes and connections. Call this FIRST.",
          inputSchema: z.object({}),
          outputSchema: toolOutputSchema,
        }),

        createFlowchart: tool({
          description: "Create a flowchart with connected nodes. Supports per-node colors for visual distinction.",
          inputSchema: z.object({
            steps: z.array(
              z.object({
                id: z.string(),
                type: z.enum(["start", "end", "process", "decision", "data", "document"]),
                label: z.string(),
                swimlane: z.string().optional(),
                strokeColor: z.string().optional().describe("Border color for this specific node (hex, named, or rgb)"),
                backgroundColor: z.string().optional().describe("Fill color for this specific node"),
              }),
            ),
            connections: z.array(
              z.object({
                from: z.string(),
                to: z.string(),
                label: z.string().optional(),
              }),
            ),
            direction: z.enum(["vertical", "horizontal"]).optional(),
            swimlanes: z.array(z.string()).optional(),
          }),
          outputSchema: toolOutputSchema,
        }),

        createWorkflow: tool({
          description: "Create n8n-style workflow automation diagrams.",
          inputSchema: z.object({
            nodes: z.array(
              z.object({
                id: z.string(),
                type: z.enum(["trigger", "action", "condition", "loop", "transform", "output"]),
                label: z.string(),
                description: z.string().optional(),
              }),
            ),
            connections: z.array(
              z.object({
                from: z.string(),
                to: z.string(),
                label: z.string().optional(),
              }),
            ),
            colorScheme: z
              .object({
                strokeColor: z.string().optional(),
                backgroundColor: z.string().optional(),
                textColor: z.string().optional(),
              })
              .optional()
              .describe("Custom colors to use for the workflow nodes."),
          }),
          outputSchema: toolOutputSchema,
        }),

        createMindMap: tool({
          description: "Create a mind map for brainstorming and idea organization.",
          inputSchema: z.object({
            centralTopic: z.string(),
            branches: z.array(
              z.object({
                id: z.string(),
                label: z.string(),
                children: z.array(z.string()).optional(),
              }),
            ),
            colorScheme: z
              .object({
                strokeColor: z.string().optional(),
                backgroundColor: z.string().optional(),
                textColor: z.string().optional(),
              })
              .optional()
              .describe("Custom colors to use for the mind map."),
          }),
          outputSchema: toolOutputSchema,
        }),

        createOrgChart: tool({
          description: "Create an organizational chart showing team hierarchy.",
          inputSchema: z.object({
            members: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                role: z.string(),
                reportsTo: z.string().optional(),
              }),
            ),
            colorScheme: z
              .object({
                strokeColor: z.string().optional(),
                backgroundColor: z.string().optional(),
                textColor: z.string().optional(),
              })
              .optional()
              .describe("Custom colors to use for the org chart."),
          }),
          outputSchema: toolOutputSchema,
        }),

        createERDiagram: tool({
          description: "Create an entity-relationship diagram for database design.",
          inputSchema: z.object({
            entities: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                attributes: z.array(
                  z.object({
                    name: z.string(),
                    type: z.string(),
                    isPrimaryKey: z.boolean().optional(),
                    isForeignKey: z.boolean().optional(),
                  }),
                ),
              }),
            ),
            relationships: z.array(
              z.object({
                from: z.string(),
                to: z.string(),
                type: z.enum(["one-to-one", "one-to-many", "many-to-many"]),
                label: z.string().optional(),
              }),
            ),
            colorScheme: z
              .object({
                strokeColor: z.string().optional(),
                backgroundColor: z.string().optional(),
                textColor: z.string().optional(),
              })
              .optional()
              .describe("Custom colors to use for the ER diagram."),
          }),
          outputSchema: toolOutputSchema,
        }),

        createNetworkDiagram: tool({
          description: "Create a network/architecture diagram showing how systems connect. Supports per-node colors.",
          inputSchema: z.object({
            nodes: z.array(
              z.object({
                id: z.string(),
                type: z.enum(["server", "database", "client", "router", "firewall", "cloud", "service"]),
                label: z.string(),
                strokeColor: z.string().optional().describe("Border color for this specific node (hex, named, or rgb)"),
                backgroundColor: z.string().optional().describe("Fill color for this specific node"),
              }),
            ),
            links: z.array(
              z.object({
                from: z.string().describe("Source node id"),
                to: z.string().describe("Target node id"),
                label: z.string().optional(),
              }),
            ).describe("Connections between nodes - REQUIRED for showing relationships"),
            topology: z.enum(["star", "ring", "mesh", "tree", "bus"]).describe("Layout topology for the diagram"),
            centerNodeId: z.string().optional().describe("Required for star topology - the central node"),
            rootNodeId: z.string().optional().describe("Required for tree topology - the root node"),
          }),
          outputSchema: toolOutputSchema,
        }),

        createMolecule: tool({
          description: "Create a molecular structure diagram. Supports common molecules like H2O, CO2, CH4, etc.",
          inputSchema: z.object({
            formula: z.string().describe("Chemical formula like H2O, CO2, CH4, C6H12O6"),
            style: z.enum(["ball-and-stick", "space-filling"]).optional(),
          }),
          outputSchema: toolOutputSchema,
        }),

        createShape: tool({
          description: "Create a basic shape on the canvas.",
          inputSchema: z.object({
            type: z.enum(["rectangle", "circle", "diamond", "text", "arrow"]),
            x: z.number(),
            y: z.number(),
            width: z.number().optional(),
            height: z.number().optional(),
            label: z.string().optional(),
            color: z.string().optional(),
          }),
          outputSchema: toolOutputSchema,
        }),

        updateShape: tool({
          description: "Update an existing shape's properties.",
          inputSchema: z.object({
            id: z.string(),
            properties: z.object({
              x: z.number().optional(),
              y: z.number().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
              label: z.string().optional(),
              color: z.string().optional(),
            }),
          }),
          outputSchema: toolOutputSchema,
        }),

        getShapeInfo: tool({
          description: "Get information about a specific shape.",
          inputSchema: z.object({
            id: z.string(),
          }),
          outputSchema: toolOutputSchema,
        }),

        updateStyles: tool({
          description:
            "Update colors and styles on existing elements without recreating the diagram. Use this when the user wants to change colors, stroke widths, or other visual properties.",
          inputSchema: z.object({
            selector: z.enum(["all", "shapes", "connections", "byType", "byIds"]).describe("Which elements to update"),
            elementType: z
              .string()
              .optional()
              .describe("When selector is 'byType', specify: rectangle, ellipse, diamond, text, line, arrow"),
            elementIds: z.array(z.string()).optional().describe("When selector is 'byIds', list specific element IDs"),
            styles: z.object({
              strokeColor: z.string().optional().describe("Border/outline color (hex, named, or rgb)"),
              backgroundColor: z.string().optional().describe("Fill color for shapes"),
              labelColor: z.string().optional().describe("Text/label color"),
              strokeWidth: z.number().optional().describe("Border width in pixels"),
              opacity: z.number().optional().describe("Opacity from 0 to 100"),
            }),
          }),
          outputSchema: toolOutputSchema,
        }),

        placeImage: tool({
          description: "Place an image on the canvas.",
          inputSchema: z.object({
            url: z.string(),
            x: z.number(),
            y: z.number(),
            width: z.number().optional(),
            height: z.number().optional(),
          }),
          outputSchema: toolOutputSchema,
        }),

        clearCanvas: tool({
          description: "Clear all shapes and connections from the canvas.",
          inputSchema: z.object({}),
          outputSchema: toolOutputSchema,
        }),

        analyzeDiagram: tool({
          description: "Analyze the current diagram and provide insights.",
          inputSchema: z.object({}),
          outputSchema: toolOutputSchema,
        }),

        beautifyDiagram: tool({
          description: "Automatically arrange and beautify the current diagram layout.",
          inputSchema: z.object({}),
          outputSchema: toolOutputSchema,
        }),

        previewDiagram: tool({
          description: "Preview changes before applying them.",
          inputSchema: z.object({
            action: z.string(),
            parameters: z.record(z.unknown()),
          }),
          outputSchema: toolOutputSchema,
        }),
      },
    })

    console.log("[v0] streamText called, returning response")
    return result.toUIMessageStreamResponse()
  } catch (error) {
    console.error("[v0] AI Chat API error:", error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}
