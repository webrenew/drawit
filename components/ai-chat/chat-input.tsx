"use client"

import type React from "react"
import { useRef } from "react"
import { Paperclip, Send, X, Loader2 } from "lucide-react"
import Image from "next/image"

interface UploadedImage {
  url: string
  file?: File
}

interface ChatInputProps {
  input: string
  onInputChange: (value: string) => void
  uploadedImages: UploadedImage[]
  onImageSelect: (file: File) => void
  onImagePaste: (file: File) => void
  onRemoveImage: (index: number) => void
  onSubmit: (e: React.FormEvent) => void
  isLoading: boolean
}

export function ChatInput({
  input,
  onInputChange,
  uploadedImages,
  onImageSelect,
  onImagePaste,
  onRemoveImage,
  onSubmit,
  isLoading,
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    files.forEach((file) => onImageSelect(file))
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items)
    const imageFiles = items
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)

    imageFiles.forEach((file) => onImagePaste(file))
  }

  return (
    <div ref={containerRef}>
      {uploadedImages.length > 0 && (
        <div className="mb-2">
          <div className="flex flex-wrap gap-2">
            {uploadedImages.map((image, index) => (
              <div key={index} className="relative group">
                <Image
                  src={image.url || "/placeholder.svg"}
                  alt={`Upload ${index + 1}`}
                  width={64}
                  height={64}
                  unoptimized
                  className="w-16 h-16 object-cover rounded border border-border"
                />
                <button
                  type="button"
                  onClick={() => onRemoveImage(index)}
                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  disabled={isLoading}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="image/*"
          multiple
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          disabled={isLoading}
        >
          <Paperclip className="w-5 h-5" />
        </button>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onPaste={handlePaste}
          inputMode="text"
          onKeyDown={(e) => {
            if (e.key === "Backspace" || e.key === "Delete") {
              e.stopPropagation()
            }
          }}
          placeholder="Describe your diagram..."
          className="flex-1 bg-background border border-border rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-ring min-w-0"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || (!input.trim() && uploadedImages.length === 0)}
          className="bg-primary text-primary-foreground rounded-lg px-4 py-2 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        >
          {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
        </button>
      </form>
    </div>
  )
}

export type { UploadedImage }
