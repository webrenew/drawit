/**
 * AI Chat API Route - AI SDK v5 with Multi-Step Reasoning
 * Uses Vercel AI Gateway for model access
 * Based on https://sdk.vercel.ai/docs/ai-sdk-ui/chatbot-tool-usage
 * 
 * Tool execution happens client-side via onToolCall in AIChatPanel.
 * This allows tools to directly mutate the canvas state.
 */

import type { UIMessage } from "ai"
import { streamText, convertToModelMessages } from "ai"
import { gateway } from "@ai-sdk/gateway"
import { allTools } from "@/lib/tools"

export const maxDuration = 60

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

MULTI-STEP REASONING:
- You can call multiple tools in sequence to complete complex tasks
- First call getCanvasState to see existing content
- Then create or modify diagrams
- You can make up to 5 tool calls per request

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

    console.log("[ai-chat] Request - model:", selectedModelId, "messages:", messages.length)

    // Use Vercel AI Gateway for all models
    const model = gateway(selectedModelId)

    const result = streamText({
      model,
      system: getSystemPrompt(currentTheme, canvas),
      messages: convertToModelMessages(messages),
      tools: allTools,
      // Multi-step reasoning is handled client-side via sendAutomaticallyWhen
      // in AIChatPanel. This allows tool execution to mutate client state.
    })

    console.log("[ai-chat] streamText called, returning response")
    return result.toUIMessageStreamResponse()
  } catch (error) {
    console.error("[ai-chat] API error:", error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}
