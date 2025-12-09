/**
 * AI Diagram API - Trigger.dev Integration
 *
 * Triggers server-side AI diagram generation using Trigger.dev
 * Returns run ID for polling status
 */

import { NextResponse } from "next/server"
import { tasks } from "@trigger.dev/sdk/v3"
import { z } from "zod"
import type { aiDiagramTask } from "@/src/trigger/ai-diagram"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export const maxDuration = 60

// Request body validation schema
const requestBodySchema = z.object({
  prompt: z.string().min(1, "Prompt is required").max(10000, "Prompt too long"),
  canvasInfo: z.object({
    centerX: z.number(),
    centerY: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }).optional(),
  theme: z.enum(["light", "dark"]).optional(),
  diagramId: z.string().uuid().optional(),
  model: z.string().max(100).optional(),
})

export async function POST(req: Request) {
  try {
    // Verify authentication
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    // Parse and validate request body
    const rawBody = await req.json()
    const parseResult = requestBodySchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { prompt, canvasInfo, theme, diagramId, model } = parseResult.data

    console.log("[ai-diagram] Triggering task for user:", user.id)

    // Trigger the background task
    const handle = await tasks.trigger<typeof aiDiagramTask>("ai-diagram-generation", {
      prompt,
      canvasInfo: canvasInfo || { centerX: 400, centerY: 300, width: 800, height: 600 },
      theme: theme || "dark",
      userId: user.id,
      diagramId,
      model: model || "anthropic/claude-opus-4.5",
    })

    console.log("[ai-diagram] Task triggered:", handle.id)

    return NextResponse.json({
      runId: handle.id,
      status: "triggered",
    })

  } catch (error) {
    console.error("[ai-diagram] Error:", error)
    // Don't expose internal error details to client
    return NextResponse.json(
      { error: "Failed to trigger diagram generation" },
      { status: 500 }
    )
  }
}

