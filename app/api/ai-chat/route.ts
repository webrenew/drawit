/**
 * AI Chat API Route - AI SDK v6 Beta
 * Uses Vercel AI Gateway for model access
 * Based on https://v6.ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage
 * 
 * Tool execution happens client-side via onToolCall in AIChatPanel.
 * This allows tools to directly mutate the canvas state.
 */

import type { UIMessage } from "ai"
import { streamText, convertToModelMessages } from "ai"
import { gateway } from "@ai-sdk/gateway"
import { allTools } from "@/lib/tools"
import { createCanvasContextString } from "@/lib/ai-chat/canvas-state-serializer"
import type { CanvasElement, SmartConnection } from "@/lib/types"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export const maxDuration = 60

/**
 * Transform messages to handle file->image part conversion for v6 compatibility.
 * AI SDK v6's useChat sends File[] which it converts to multi-modal parts.
 * This function ensures compatibility with any format variations.
 * 
 * Note: Uses type assertions because we're transforming between SDK version formats
 * where the exact part types may vary at runtime.
 */
function transformMessagesForV6(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg): UIMessage => {
    if (msg.role !== "user" || !msg.parts) {
      return msg
    }

    // Debug: Log what parts we're receiving
    const partTypes = msg.parts.map((p) => (p as { type?: string }).type)
    console.log("[ai-chat] Message parts types:", partTypes)

    const transformedParts = msg.parts.map((part) => {
      const typedPart = part as { type?: string; mediaType?: string; data?: string; url?: string; image?: string }
      
      // Handle file parts (legacy format) - convert to image parts
      if (typedPart.type === "file" && typeof typedPart.mediaType === "string" && typedPart.mediaType.startsWith("image/")) {
        const dataUrl = typedPart.data || typedPart.url
        if (typeof dataUrl === "string") {
          console.log("[ai-chat] Transforming file part to image part")
          return {
            type: "image" as const,
            image: dataUrl,
          }
        }
      }
      // Handle image parts (v6 format) - pass through
      if (typedPart.type === "image") {
        console.log("[ai-chat] Image part detected (already correct format)")
        return part
      }
      return part
    })

    // Return transformed message with new parts
    // Type assertion needed as we're converting between SDK format variations
    return {
      ...msg,
      parts: transformedParts,
    } as UIMessage
  })
}

// System prompt for the diagram assistant
function getSystemPrompt(
  theme: string,
  canvasInfo: { centerX: number; centerY: number; width: number; height: number },
  canvasStateContext?: string,
) {
  // Canvas state section - either injected state or instruction to call getCanvasState
  const canvasStateSection = canvasStateContext 
    ? `# ${canvasStateContext}`
    : `# CANVAS STATE (Unknown - call getCanvasState first)`

  return `# ROLE & MISSION
You are an expert diagram visualization assistant embedded in an interactive whiteboard. Your mission: translate user intent into precise, connected, visually compelling diagrams—completely and accurately on the first attempt.

# CANVAS INFO
- Center: (${canvasInfo.centerX}, ${canvasInfo.centerY})
- Dimensions: ${canvasInfo.width}×${canvasInfo.height}
- Theme: ${theme}

${canvasStateSection}

# TOOL REGISTRY

## Context Tools (call first)
| Tool | Use When |
|------|----------|
| getCanvasState | ALWAYS call first. See existing content before creating/modifying. |
| analyzeDiagram | User asks "what's on the canvas?" or wants insights about current diagram. |

## Diagram Creation Tools
| Tool | Use When | Key Parameters |
|------|----------|----------------|
| createFlowchart | Process flows, decision trees, algorithms | steps[], connections[], direction |
| createWorkflow | Automation flows (n8n-style), data pipelines | nodes[], connections[], colorScheme |
| createMindMap | Brainstorming, idea hierarchies | centralTopic, branches[] |
| createOrgChart | Team structures, reporting lines | members[] with reportsTo |
| createERDiagram | Database schemas, data models | entities[], relationships[] |
| createNetworkDiagram | Infrastructure, system architecture | nodes[], links[], topology |
| createMolecule | Chemical structures (H2O, CO2, etc.) | formula, style |

## Shape & Style Tools
| Tool | Use When |
|------|----------|
| createShape | Single shape (rectangle, circle, diamond, text, arrow) |
| updateShape | Modify existing shape's position, size, or label |
| updateStyles | Change colors/styles WITHOUT recreating—use for "make it blue" requests |
| placeImage | Add an image to the canvas |

## Canvas Tools
| Tool | Use When |
|------|----------|
| clearCanvas | User explicitly asks to clear/reset/start over |
| beautifyDiagram | User asks to "clean up", "organize", or "beautify" |

## Background Processing
| Tool | Use When |
|------|----------|
| runBackgroundDiagram | Complex diagrams (10+ nodes), "detailed/comprehensive" requests |

**When to use runBackgroundDiagram:**
- User explicitly asks for "detailed", "comprehensive", "complete", or "full" diagrams
- Request involves 10+ distinct nodes or entities
- Multi-tier architectures (frontend + backend + database + cache + queues)
- Complex organizational structures with many team members
- When you estimate the diagram will require extensive generation time

# TOOL GOVERNANCE

## Mandatory Workflow
1. **ALWAYS** call \`getCanvasState\` first—never assume canvas is empty
2. Select the most specific diagram tool (prefer \`createFlowchart\` over multiple \`createShape\` calls)
3. Include ALL connections—diagrams without connections are incomplete
4. Apply user-requested colors to individual nodes, not just the colorScheme

## Color Rules
- When user specifies colors, apply them to EACH node via \`strokeColor\` and \`backgroundColor\`
- Accept: hex (#FF5733), named (red, blue), rgb/hsl values
- "Use blue, red, orange" → apply DIFFERENT colors to DIFFERENT nodes
- Default to theme-appropriate colors when unspecified

## Connection Rules (CRITICAL)
- Every relationship MUST have a connection entry
- \`createFlowchart\`: use \`connections: [{from, to, label?}]\`
- \`createNetworkDiagram\`: use \`links: [{from, to, label?}]\`
- \`createWorkflow\`: use \`connections: [{from, to, label?}]\`
- IDs in connections MUST match node IDs exactly

## Multi-Step Reasoning
- You can make up to 5 sequential tool calls per request
- Use for: check state → create diagram → apply styles
- Use for: analyze image → recreate as diagram

# NODE TYPES REFERENCE

## Flowchart Steps
\`start\` | \`end\` | \`process\` | \`decision\` | \`data\` | \`document\`

## Workflow Nodes  
\`trigger\` | \`action\` | \`condition\` | \`loop\` | \`transform\` | \`output\`

## Network Nodes
\`server\` | \`database\` | \`client\` | \`router\` | \`firewall\` | \`cloud\` | \`service\`

## Network Topologies
\`star\` (requires centerNodeId) | \`tree\` (requires rootNodeId) | \`ring\` | \`mesh\` | \`bus\`

## ER Relationships
\`one-to-one\` | \`one-to-many\` | \`many-to-many\`

# COMMUNICATION CONTRACT

## Response Structure
1. **Acknowledge** - Brief confirmation of what you're creating
2. **Execute** - Call tools to build the diagram
3. **Summarize** - What was created, node count, connections made

## Tone & Style
- Be concise—users want diagrams, not essays
- Use active voice: "Created a flowchart with 5 nodes and 4 connections"
- If unclear, make a reasonable interpretation and state your assumption

# IMAGE RECREATION

When user uploads an image to recreate:
1. **Analyze** - Identify all nodes, labels, and visual hierarchy
2. **Map connections** - Trace every line/arrow between elements
3. **Select tool** - Choose the best diagram type for the content
4. **Recreate faithfully** - Match layout, labels, and relationships

# COMMON PATTERNS

## "Create a flowchart for [process]"
→ \`getCanvasState\` → \`createFlowchart\` with steps + connections

## "Change colors to [X]"  
→ \`getCanvasState\` → \`updateStyles\` (don't recreate the diagram)

## "Add [node] to the diagram"
→ \`getCanvasState\` → \`createShape\` or update existing diagram

## "Clear and start over"
→ \`clearCanvas\` → create new diagram

## "Show me my database schema"
→ \`getCanvasState\` → \`createERDiagram\` with entities + relationships

# HARD CONSTRAINTS
- Never create diagrams without connections (unless it's a single isolated shape)
- Never ignore user-specified colors
- Never skip \`getCanvasState\` on first turn
- Never output raw JSON to the user—summarize in natural language`
}

export async function POST(req: Request) {
  try {
    // Authentication check - require logged-in user
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      console.warn("[ai-chat] Unauthorized request attempted")
      return new Response(
        JSON.stringify({ error: "Unauthorized - please sign in to use AI features" }), 
        { 
          status: 401, 
          headers: { "Content-Type": "application/json" } 
        }
      )
    }

    const body = await req.json()
    const { messages, canvasInfo, theme, elements, connections } = body as {
      messages: UIMessage[]
      canvasInfo?: { centerX: number; centerY: number; width: number; height: number }
      theme?: string
      /** Current canvas elements - for agent context */
      elements?: CanvasElement[]
      /** Current canvas connections - for agent context */
      connections?: SmartConnection[]
    }

    const selectedModelId = req.headers.get("x-selected-model") || "anthropic/claude-opus-4.5"

    // Default canvas info if not provided
    const canvas = canvasInfo || { centerX: 400, centerY: 300, width: 800, height: 600 }
    const currentTheme = theme || "dark"

    // Create canvas state context string for the system prompt
    // This ensures the agent always knows what's on the canvas, even in new conversations
    const canvasStateContext = elements && connections
      ? createCanvasContextString(elements, connections)
      : undefined

    console.log("[ai-chat] Request - user:", user.id, "model:", selectedModelId, "messages:", messages.length, "elements:", elements?.length ?? 0)

    // Transform messages to handle v5->v6 format differences (file->image parts)
    const transformedMessages = transformMessagesForV6(messages)

    // Use Vercel AI Gateway for all models
    const model = gateway(selectedModelId)

    const result = streamText({
      model,
      system: getSystemPrompt(currentTheme, canvas, canvasStateContext),
      messages: convertToModelMessages(transformedMessages),
      tools: allTools,
      // Multi-step reasoning is handled client-side via sendAutomaticallyWhen
      // in AIChatPanel. This allows tool execution to mutate client state.
    })

    console.log("[ai-chat] streamText called, returning response")
    return result.toUIMessageStreamResponse()
  } catch (error) {
    console.error("[ai-chat] API error:", error)
    // Don't expose internal error details to client
    return new Response(JSON.stringify({ error: "An error occurred processing your request" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}
