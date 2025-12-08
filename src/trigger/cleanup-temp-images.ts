/**
 * Scheduled Task: Clean up expired temp images
 * Runs daily to remove images older than 24 hours from Supabase Storage
 */

import { schedules } from "@trigger.dev/sdk/v3"
import { createClient } from "@supabase/supabase-js"

// Create Supabase client with service role for cleanup operations
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

interface TempImageRecord {
  id: string
  user_id: string
  storage_path: string
  public_url: string
  created_at: string
  expires_at: string
}

export const cleanupTempImagesTask = schedules.task({
  id: "cleanup-temp-images",
  // Run every day at 3:00 AM UTC
  cron: "0 3 * * *",
  run: async () => {
    console.log("[cleanup] Starting temp images cleanup...")
    
    const supabase = getSupabaseAdmin()
    const now = new Date().toISOString()
    
    // Get all expired images
    const { data: expiredImages, error: fetchError } = await supabase
      .from("temp_images")
      .select("*")
      .lt("expires_at", now)
    
    if (fetchError) {
      console.error("[cleanup] Failed to fetch expired images:", fetchError)
      return {
        success: false,
        error: fetchError.message,
        deleted: 0,
        errors: 0,
      }
    }
    
    if (!expiredImages || expiredImages.length === 0) {
      console.log("[cleanup] No expired images to clean up")
      return {
        success: true,
        deleted: 0,
        errors: 0,
        message: "No expired images found",
      }
    }
    
    console.log(`[cleanup] Found ${expiredImages.length} expired images`)
    
    let deleted = 0
    let errors = 0
    
    // Delete from storage in batches
    const storagePaths = expiredImages.map((img: TempImageRecord) => img.storage_path)
    const batchSize = 100
    
    for (let i = 0; i < storagePaths.length; i += batchSize) {
      const batch = storagePaths.slice(i, i + batchSize)
      
      const { error: deleteError } = await supabase.storage
        .from("temp-images")
        .remove(batch)
      
      if (deleteError) {
        console.error(`[cleanup] Failed to delete batch ${i / batchSize + 1}:`, deleteError)
        errors += batch.length
      } else {
        deleted += batch.length
        console.log(`[cleanup] Deleted batch ${i / batchSize + 1}: ${batch.length} files`)
      }
    }
    
    // Delete records from temp_images table
    const { error: dbDeleteError } = await supabase
      .from("temp_images")
      .delete()
      .lt("expires_at", now)
    
    if (dbDeleteError) {
      console.error("[cleanup] Failed to delete temp_images records:", dbDeleteError)
    }
    
    const result = {
      success: errors === 0,
      deleted,
      errors,
      totalFound: expiredImages.length,
      timestamp: now,
    }
    
    console.log("[cleanup] Cleanup complete:", result)
    return result
  },
})

