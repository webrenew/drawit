/**
 * Image Service
 * Handles uploading images to Supabase Storage for AI chat
 */

import { createClient } from "@/lib/supabase/client"
import { nanoid } from "nanoid"

const BUCKET_NAME = "temp-images"

export interface UploadedImageResult {
  success: boolean
  url?: string
  storagePath?: string
  error?: string
}

export interface TempImageRecord {
  id: string
  user_id: string
  storage_path: string
  public_url: string
  file_name: string
  file_size: number
  mime_type: string
  created_at: string
  expires_at: string
}

class ImageService {
  private supabase = createClient()

  /**
   * Upload an image file to Supabase Storage
   * Returns a public URL that the AI can access
   */
  async uploadImage(file: File, userId: string): Promise<UploadedImageResult> {
    try {
      // Generate unique path: userId/timestamp_randomId.ext
      const fileExt = file.name.split(".").pop() || "png"
      const fileName = `${Date.now()}_${nanoid(8)}.${fileExt}`
      const storagePath = `${userId}/${fileName}`

      // Upload to Supabase Storage
      const { data, error } = await this.supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, file, {
          contentType: file.type,
          cacheControl: "3600", // 1 hour cache
          upsert: false,
        })

      if (error) {
        console.error("[ImageService] Upload error:", error)
        return { success: false, error: error.message }
      }

      // Get public URL
      const { data: urlData } = this.supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(storagePath)

      const publicUrl = urlData.publicUrl

      // Record in temp_images table for tracking/cleanup
      const { error: recordError } = await this.supabase
        .from("temp_images")
        .insert({
          user_id: userId,
          storage_path: storagePath,
          public_url: publicUrl,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
        })

      if (recordError) {
        console.warn("[ImageService] Failed to record image metadata:", recordError)
        // Don't fail the upload, just log the warning
      }

      console.log("[ImageService] Image uploaded:", publicUrl)
      return {
        success: true,
        url: publicUrl,
        storagePath,
      }
    } catch (err) {
      console.error("[ImageService] Unexpected error:", err)
      return {
        success: false,
        error: err instanceof Error ? err.message : "Upload failed",
      }
    }
  }

  /**
   * Upload multiple images
   */
  async uploadImages(files: File[], userId: string): Promise<UploadedImageResult[]> {
    return Promise.all(files.map((file) => this.uploadImage(file, userId)))
  }

  /**
   * Delete an image from storage
   */
  async deleteImage(storagePath: string): Promise<boolean> {
    try {
      const { error } = await this.supabase.storage
        .from(BUCKET_NAME)
        .remove([storagePath])

      if (error) {
        console.error("[ImageService] Delete error:", error)
        return false
      }

      // Also delete from temp_images table
      await this.supabase
        .from("temp_images")
        .delete()
        .eq("storage_path", storagePath)

      return true
    } catch (err) {
      console.error("[ImageService] Delete failed:", err)
      return false
    }
  }

  /**
   * Get expired images for cleanup (used by Trigger.dev task)
   */
  async getExpiredImages(): Promise<TempImageRecord[]> {
    const { data, error } = await this.supabase
      .from("temp_images")
      .select("*")
      .lt("expires_at", new Date().toISOString())

    if (error) {
      console.error("[ImageService] Failed to get expired images:", error)
      return []
    }

    return data || []
  }

  /**
   * Delete expired images (used by Trigger.dev task)
   */
  async cleanupExpiredImages(): Promise<{ deleted: number; errors: number }> {
    const expired = await this.getExpiredImages()
    let deleted = 0
    let errors = 0

    for (const image of expired) {
      const success = await this.deleteImage(image.storage_path)
      if (success) {
        deleted++
      } else {
        errors++
      }
    }

    console.log(`[ImageService] Cleanup complete: ${deleted} deleted, ${errors} errors`)
    return { deleted, errors }
  }
}

export const imageService = new ImageService()

