/**
 * Scheduled Task: Database Maintenance
 * Runs weekly to clean up orphaned data and report on database health
 * 
 * Note: Supabase runs PostgreSQL autovacuum automatically.
 * This task handles application-level cleanup that autovacuum can't do.
 */

import { schedules } from "@trigger.dev/sdk/v3"
import { createClient } from "@supabase/supabase-js"

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase environment variables")
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })
}

interface MaintenanceResult {
  task: string
  success: boolean
  count?: number
  error?: string
}

export const dbMaintenanceTask = schedules.task({
  id: "db-maintenance-weekly",
  // Run every Sunday at 4:00 AM UTC
  cron: "0 4 * * 0",
  run: async () => {
    console.log("[db-maintenance] Starting weekly database maintenance...")
    
    const supabase = getSupabaseAdmin()
    const results: MaintenanceResult[] = []
    const now = new Date()

    // 1. Clean up orphaned chat sessions (no messages, older than 7 days)
    try {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      
      // Find sessions with no messages
      const { data: emptySessions, error: findError } = await supabase
        .from("chat_sessions")
        .select("id")
        .lt("created_at", weekAgo)
      
      if (findError) throw findError
      
      if (emptySessions && emptySessions.length > 0) {
        // Check which ones have no messages
        const sessionIds = emptySessions.map(s => s.id)
        const { data: sessionsWithMessages } = await supabase
          .from("chat_messages")
          .select("session_id")
          .in("session_id", sessionIds)
        
        const sessionsWithMessagesSet = new Set(sessionsWithMessages?.map(m => m.session_id) || [])
        const orphanedSessions = sessionIds.filter(id => !sessionsWithMessagesSet.has(id))
        
        if (orphanedSessions.length > 0) {
          const { error: deleteError } = await supabase
            .from("chat_sessions")
            .delete()
            .in("id", orphanedSessions)
          
          if (deleteError) throw deleteError
          
          results.push({
            task: "cleanup_empty_chat_sessions",
            success: true,
            count: orphanedSessions.length,
          })
          console.log(`[db-maintenance] Deleted ${orphanedSessions.length} empty chat sessions`)
        } else {
          results.push({ task: "cleanup_empty_chat_sessions", success: true, count: 0 })
        }
      } else {
        results.push({ task: "cleanup_empty_chat_sessions", success: true, count: 0 })
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error"
      results.push({ task: "cleanup_empty_chat_sessions", success: false, error })
      console.error("[db-maintenance] Failed to cleanup empty sessions:", error)
    }

    // 2. Clean up expired temp images (backup for daily task)
    try {
      const { data: expiredImages, error: findError } = await supabase
        .from("temp_images")
        .select("id, storage_path")
        .lt("expires_at", now.toISOString())
      
      if (findError) throw findError
      
      if (expiredImages && expiredImages.length > 0) {
        // Delete from storage
        const paths = expiredImages.map(img => img.storage_path)
        await supabase.storage.from("temp-images").remove(paths)
        
        // Delete from table
        const { error: deleteError } = await supabase
          .from("temp_images")
          .delete()
          .lt("expires_at", now.toISOString())
        
        if (deleteError) throw deleteError
        
        results.push({
          task: "cleanup_expired_temp_images",
          success: true,
          count: expiredImages.length,
        })
        console.log(`[db-maintenance] Deleted ${expiredImages.length} expired temp images`)
      } else {
        results.push({ task: "cleanup_expired_temp_images", success: true, count: 0 })
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error"
      results.push({ task: "cleanup_expired_temp_images", success: false, error })
      console.error("[db-maintenance] Failed to cleanup temp images:", error)
    }

    // 3. Get table row counts for monitoring
    const tableCounts: Record<string, number> = {}
    const tables = ["profiles", "diagrams", "chat_sessions", "chat_messages", "temp_images"]
    
    for (const table of tables) {
      try {
        const { count, error } = await supabase
          .from(table)
          .select("*", { count: "exact", head: true })
        
        if (!error && count !== null) {
          tableCounts[table] = count
        }
      } catch {
        console.warn(`[db-maintenance] Could not count ${table}`)
      }
    }

    // 4. Check for any orphaned storage files (files in bucket but not in temp_images table)
    try {
      const { data: storageFiles, error: listError } = await supabase.storage
        .from("temp-images")
        .list("", { limit: 1000 })
      
      if (!listError && storageFiles) {
        // Get all tracked paths
        const { data: trackedImages } = await supabase
          .from("temp_images")
          .select("storage_path")
        
        const trackedPaths = new Set(trackedImages?.map(img => img.storage_path) || [])
        
        // Find orphaned files (in storage but not tracked)
        // Note: This is a simplified check - folders contain user IDs
        const orphanedCount = storageFiles.filter(f => 
          f.name && !f.name.startsWith(".") && !trackedPaths.has(f.name)
        ).length
        
        results.push({
          task: "check_orphaned_storage",
          success: true,
          count: orphanedCount,
        })
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error"
      results.push({ task: "check_orphaned_storage", success: false, error })
    }

    const successCount = results.filter(r => r.success).length
    const report = {
      success: successCount === results.length,
      tasksCompleted: successCount,
      totalTasks: results.length,
      results,
      tableCounts,
      timestamp: now.toISOString(),
    }
    
    console.log("[db-maintenance] Weekly maintenance complete:", JSON.stringify(report, null, 2))
    return report
  },
})
