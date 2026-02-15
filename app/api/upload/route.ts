import { createServerSupabaseClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import sanitizeHtml from "sanitize-html"

// Security constants
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const STORAGE_BUCKET = "temp-images"
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
 * Sanitize SVG content to prevent XSS attacks
 * Removes script tags, event handlers, and other dangerous content
 * Uses sanitize-html which works in serverless environments (Node.js native)
 */
function sanitizeSVG(svgContent: string): string {
  const cleanSVG = sanitizeHtml(svgContent, {
    allowedTags: [
      'svg', 'g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon',
      'text', 'tspan', 'defs', 'clipPath', 'mask', 'pattern', 'linearGradient',
      'radialGradient', 'stop', 'use', 'symbol', 'marker', 'title', 'desc'
    ],
    allowedAttributes: {
      '*': [
        'id', 'class', 'style', 'transform', 'fill', 'stroke', 'stroke-width',
        'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity',
        'fill-opacity', 'stroke-opacity', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
        'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd', 'points',
        'viewBox', 'preserveAspectRatio', 'xmlns', 'xmlns:xlink'
      ],
      'svg': ['viewBox', 'width', 'height', 'xmlns', 'xmlns:xlink', 'version'],
      'use': ['href', 'xlink:href', 'x', 'y', 'width', 'height'],
      'linearGradient': ['x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform'],
      'radialGradient': ['cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform'],
      'stop': ['offset', 'stop-color', 'stop-opacity'],
      'text': ['x', 'y', 'dx', 'dy', 'text-anchor', 'font-family', 'font-size', 'font-weight'],
      'a': ['href', 'target'], // Allow links but target will be filtered by disallowedTagsMode
    },
    // Disallow all event handlers (on*)
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      'a': ['http', 'https', 'mailto'],
    },
    // Remove any attributes starting with 'on' (event handlers)
    transformTags: {
      '*': (tagName, attribs) => {
        const sanitizedAttribs: Record<string, string> = {}
        for (const [key, value] of Object.entries(attribs)) {
          // Block all event handlers
          if (!key.toLowerCase().startsWith('on')) {
            sanitizedAttribs[key] = value
          }
        }
        return {
          tagName,
          attribs: sanitizedAttribs,
        }
      },
    },
  })

  return cleanSVG
}

/**
 * Validate file magic numbers to prevent MIME type spoofing
 * Returns sanitized content for SVGs, null for other valid files
 */
async function validateImageSignature(file: File): Promise<{ valid: boolean; sanitizedContent?: string }> {
  const mimeType = file.type
  const signatures = IMAGE_SIGNATURES[mimeType]

  // SVG doesn't have magic numbers - validate by checking for XML/SVG content
  if (mimeType === "image/svg+xml") {
    const text = await file.text()
    const isValidSVG = text.includes("<svg") || text.includes("<?xml")

    if (!isValidSVG) {
      return { valid: false }
    }

    // Sanitize SVG content to prevent XSS
    const sanitizedContent = sanitizeSVG(text)

    // Verify sanitization didn't completely remove content
    if (!sanitizedContent || sanitizedContent.length < 10) {
      return { valid: false }
    }

    return { valid: true, sanitizedContent }
  }

  // If no signature defined for this type, skip magic number check
  if (!signatures) {
    return { valid: true }
  }

  const buffer = await file.slice(0, 12).arrayBuffer()
  const bytes = new Uint8Array(buffer)

  const isValid = signatures.some(signature =>
    signature.every((byte, index) => bytes[index] === byte)
  )

  return { valid: isValid }
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
    const validationResult = await validateImageSignature(file)
    if (!validationResult.valid) {
      return NextResponse.json(
        { error: "File content does not match declared type" },
        { status: 400 }
      )
    }

    // Generate unique filename with crypto-safe random
    const fileExt = file.name.split(".").pop()?.toLowerCase() || "bin"
    const randomId = crypto.randomUUID()
    const fileName = `${user.id}/${Date.now()}-${randomId}.${fileExt}`

    // Use sanitized content for SVGs, original file for other types
    const uploadContent = validationResult.sanitizedContent
      ? new Blob([validationResult.sanitizedContent], { type: file.type })
      : file

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(fileName, uploadContent, {
        contentType: file.type,
        upsert: false,
      })

    if (error) {
      console.error("[upload] Storage error:", error)
      return NextResponse.json({ error: "Failed to upload file" }, { status: 500 })
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(data.path)

    const { error: metadataError } = await supabase.from("temp_images").insert({
      user_id: user.id,
      storage_path: data.path,
      public_url: publicUrl,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
    })

    if (metadataError) {
      console.error("[upload] Failed to register temp image metadata:", metadataError)

      const { error: cleanupError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([data.path])

      if (cleanupError) {
        console.error("[upload] Failed to remove untracked uploaded file:", cleanupError)
      }

      return NextResponse.json({ error: "Failed to register uploaded file" }, { status: 500 })
    }

    return NextResponse.json({ url: publicUrl, storagePath: data.path })
  } catch (error) {
    console.error("[upload] Error:", error)
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 })
  }
}
