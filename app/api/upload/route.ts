import { createServerSupabaseClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

// Security constants
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]

// Magic number signatures for image validation
const IMAGE_SIGNATURES: Record<string, number[][]> = {
  "image/jpeg": [[0xFF, 0xD8, 0xFF]],
  "image/png": [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  "image/gif": [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]], // GIF87a, GIF89a
  "image/webp": [[0x52, 0x49, 0x46, 0x46]], // RIFF (WebP starts with RIFF)
}

/**
 * Validate file magic numbers to prevent MIME type spoofing
 */
async function validateImageSignature(file: File): Promise<boolean> {
  const mimeType = file.type
  const signatures = IMAGE_SIGNATURES[mimeType]

  // SVG doesn't have magic numbers - validate by checking for XML/SVG content
  if (mimeType === "image/svg+xml") {
    const text = await file.slice(0, 500).text()
    return text.includes("<svg") || text.includes("<?xml")
  }

  // If no signature defined for this type, skip magic number check
  if (!signatures) {
    return true
  }

  const buffer = await file.slice(0, 12).arrayBuffer()
  const bytes = new Uint8Array(buffer)

  return signatures.some(signature =>
    signature.every((byte, index) => bytes[index] === byte)
  )
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()

    // Check if user is authenticated
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      )
    }

    // Validate MIME type (allowlist)
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: JPEG, PNG, GIF, WebP, SVG" },
        { status: 400 }
      )
    }

    // Validate magic numbers to prevent MIME type spoofing
    const isValidSignature = await validateImageSignature(file)
    if (!isValidSignature) {
      return NextResponse.json(
        { error: "File content does not match declared type" },
        { status: 400 }
      )
    }

    // Generate unique filename with crypto-safe random
    const fileExt = file.name.split(".").pop()?.toLowerCase() || "bin"
    const randomId = crypto.randomUUID()
    const fileName = `${user.id}/${Date.now()}-${randomId}.${fileExt}`

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from("images")
      .upload(fileName, file, {
        contentType: file.type,
        upsert: false,
      })

    if (error) {
      console.error("[upload] Storage error:", error)
      return NextResponse.json({ error: "Failed to upload file" }, { status: 500 })
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from("images")
      .getPublicUrl(data.path)

    return NextResponse.json({ url: publicUrl })
  } catch (error) {
    console.error("[upload] Error:", error)
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 })
  }
}
