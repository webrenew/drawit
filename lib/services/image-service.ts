/**
 * Image Service
 * Handles uploading images for AI chat.
 */

import { createClient } from "@/lib/supabase/client"

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
   * Upload an image file through the validated server upload endpoint.
   */
  async uploadImage(file: File): Promise<UploadedImageResult> {
    try {
      const formData = new FormData()
      formData.set("file", file)

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      const payload = (await response.json()) as {
        url?: string
        storagePath?: string
        error?: string
      }
      if (!response.ok || !payload.url) {
        return { success: false, error: payload.error || "Upload failed" }
      }

      return {
        success: true,
        url: payload.url,
        storagePath: payload.storagePath,
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
  async uploadImages(files: File[]): Promise<UploadedImageResult[]> {
    return Promise.all(files.map((file) => this.uploadImage(file)))
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



