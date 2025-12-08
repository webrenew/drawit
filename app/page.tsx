"use client"

import { useState } from "react"
import { Canvas } from "@/components/editor/canvas"
import { DrawingRoomProvider } from "@/components/room-provider"
import { AIChatPanel } from "@/components/ai-chat-panel"
import type { PreviewState } from "@/lib/types"

export default function EditorPage() {
  const [previewState, setPreviewState] = useState<PreviewState | null>(null)

  return (
    <main className="w-screen h-screen overflow-hidden bg-white relative">
      <DrawingRoomProvider>
        <Canvas previewElements={previewState} />
        <AIChatPanel onPreviewChange={setPreviewState} />
      </DrawingRoomProvider>
    </main>
  )
}
