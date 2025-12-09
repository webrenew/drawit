/**
 * AI Diagram Run Status API
 * 
 * Poll for Trigger.dev task status and get results
 */

import { NextResponse } from "next/server"
import { runs } from "@trigger.dev/sdk/v3"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
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

    const { runId } = await params

    if (!runId) {
      return NextResponse.json(
        { error: "Run ID is required" },
        { status: 400 }
      )
    }

    // Get run status from Trigger.dev
    const run = await runs.retrieve(runId)

    if (!run) {
      return NextResponse.json(
        { error: "Run not found" },
        { status: 404 }
      )
    }

    // Check if the run belongs to this user (via metadata)
    const runUserId = run.metadata?.userId as string | undefined
    if (runUserId && runUserId !== user.id) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      )
    }

    const response: {
      runId: string
      status: string
      output?: unknown
      error?: string
    } = {
      runId: run.id,
      status: run.status,
    }

    if (run.status === "COMPLETED" && run.output) {
      response.output = run.output
    }

    if (run.status === "FAILED") {
      response.error = "Task failed"
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error("[ai-diagram-status] Error:", error)
    // Don't expose internal error details to client
    return NextResponse.json(
      { error: "Failed to retrieve run status" },
      { status: 500 }
    )
  }
}

