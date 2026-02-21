"use client"

import dynamic from "next/dynamic"
import { Canvas } from "@/components/editor/canvas"
import { DrawingRoomProvider } from "@/components/room-provider"

const AIChatPanel = dynamic(
  () => import("@/components/ai-chat-panel").then((mod) => mod.AIChatPanel),
  { ssr: false },
)

export default function EditorPage() {
  return (
    <main className="w-screen h-screen overflow-hidden bg-white relative">
      <DrawingRoomProvider>
        <Canvas />
        <AIChatPanel />
      </DrawingRoomProvider>
    </main>
  )
}
