/**
 * AI Chat Panel - AI SDK v5 Stable
 * Based on https://sdk.vercel.ai/docs/ai-sdk-ui/chatbot-tool-usage
 */

"use client"

import type React from "react"
import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai"
import { useCanvasStore } from "@/lib/store"
import { MessageSquare, X, Trash2 } from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { nanoid } from "nanoid"
import type { FileUIPart } from "ai"

// Types and constants
import type { ToolHandlerContext, ShapeRegistry, ShapeDataRegistry, AIChatPanelProps } from "@/lib/ai-chat/types"
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "@/lib/ai-chat/types"
import { getCanvasInfo } from "@/lib/ai-chat/canvas-helpers"
import type { CanvasElement, SmartConnection } from "@/lib/types"

// UI Components
import { ChatMessages } from "@/components/ai-chat/chat-messages"
import { ChatInput, type UploadedImage } from "@/components/ai-chat/chat-input"
import { ModelSelector } from "@/components/ai-chat/model-selector"

// Tool handlers
import {
  handleGetCanvasState,
  handleCreateFlowchart,
  handleCreateDiagram,
  handleCreateOrgChart,
  handleCreateERDiagram,
  handleCreateNetworkDiagram,
  handleCreateMolecule,
  handleCreateShape,
  handleUpdateShape,
  handleGetShapeInfo,
  handlePlaceImage,
  handleClearCanvas,
  handleAnalyzeDiagram,
  handleBeautifyDiagram,
  handlePreviewDiagram,
  handleUpdateStyles,
} from "@/lib/ai-chat/tool-handlers"

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const CHAT_HISTORY_LOCAL_KEY = "drawit-chat-history"

export function AIChatPanel({ onPreviewChange, canvasDimensions, onElementsCreated }: AIChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState("")
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([])
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const { resolvedTheme } = useTheme()
  const isMobile = useIsMobile()

  const elements = useCanvasStore((state) => state.elements)
  const addElement = useCanvasStore((state) => state.addElement)
  const addConnection = useCanvasStore((state) => state.addConnection)
  const updateElements = useCanvasStore((state) => state.updateElements)
  const clearAll = useCanvasStore((state) => state.clearAll)

  const shapeRegistryRef = useRef<ShapeRegistry>(new Map())
  const shapeDataRef = useRef<ShapeDataRegistry>(new Map())

  const elementsRef = useRef<CanvasElement[]>(elements)
  useEffect(() => {
    elementsRef.current = elements
  }, [elements])

  const addElementMutation = useCallback(
    (element: Omit<CanvasElement, "id"> | CanvasElement) => {
      const elementWithId: CanvasElement = {
        ...element,
        id: "id" in element && element.id ? element.id : nanoid(),
      }
      addElement(elementWithId)
    },
    [addElement],
  )

  const addConnectionMutation = useCallback(
    (connection: Omit<SmartConnection, "id">) => {
      const connectionWithId: SmartConnection = {
        ...connection,
        id: nanoid(),
      }
      addConnection(connectionWithId)
    },
    [addConnection],
  )

  const canvasInfo = useMemo(() => getCanvasInfo(canvasDimensions, elements), [canvasDimensions, elements])

  const getToolContext = useCallback(
    (): ToolHandlerContext => ({
      resolvedTheme,
      shapeRegistryRef,
      shapeDataRef,
      addElementMutation,
      addConnectionMutation,
      updateElements: (updates: Partial<CanvasElement>[]) => {
        updateElements((currentElements) => {
          return currentElements.map((el) => {
            const update = updates.find((u) => u.id === el.id)
            if (update) {
              return { ...el, ...update }
            }
            return el
          })
        })
      },
      clearCanvas: () => {
        clearAll()
        shapeRegistryRef.current.clear()
        shapeDataRef.current.clear()
      },
      elements: elementsRef.current, // Use ref for fresh elements
      canvasDimensions,
    }),
    [resolvedTheme, addElementMutation, addConnectionMutation, updateElements, clearAll, canvasDimensions],
  )

  const { messages, sendMessage, addToolResult, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai-chat",
      headers: () => ({
        "x-selected-model": selectedModel,
      }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,

    onToolCall: async ({ toolCall }) => {
      if (!toolCall || !toolCall.toolName) {
        console.error("[v0] Invalid tool call")
        return
      }

      console.log("[v0] Tool call received:", toolCall.toolName)
      const args = toolCall.input as any

      const toolContext = getToolContext()
      console.log("[v0] Tool context elements count:", toolContext.elements?.length ?? 0)

      try {
        let result: unknown

        switch (toolCall.toolName) {
          case "getCanvasState":
            result = handleGetCanvasState(toolContext)
            break
          case "createFlowchart":
            result = handleCreateFlowchart(args, toolContext)
            break
          case "createWorkflow":
            result = handleCreateFlowchart(args, toolContext)
            break
          case "createMindMap":
            result = handleCreateDiagram(args, toolContext)
            break
          case "createOrgChart":
            result = handleCreateOrgChart(args, toolContext)
            break
          case "createERDiagram":
            result = handleCreateERDiagram(args, toolContext)
            break
          case "createNetworkDiagram":
            result = handleCreateNetworkDiagram(args, toolContext)
            break
          case "createMolecule":
            result = handleCreateMolecule(args, toolContext)
            break
          case "createShape":
            result = handleCreateShape(args, toolContext)
            break
          case "updateShape":
            result = handleUpdateShape(args, toolContext)
            break
          case "getShapeInfo":
            result = handleGetShapeInfo(args, toolContext)
            break
          case "placeImage":
            result = await handlePlaceImage(args, toolContext)
            break
          case "clearCanvas":
            result = handleClearCanvas(toolContext)
            break
          case "updateStyles":
            result = handleUpdateStyles(args, toolContext)
            break
          case "analyzeDiagram":
            result = handleAnalyzeDiagram(toolContext)
            break
          case "beautifyDiagram":
            result = handleBeautifyDiagram(toolContext)
            break
          case "previewDiagram":
            result = handlePreviewDiagram(args)
            break
          default:
            result = { error: `Unknown tool: ${toolCall.toolName}` }
        }

        const resultString = typeof result === "string" ? result : JSON.stringify(result)
        console.log("[v0] Tool result:", resultString.substring(0, 200))

        addToolResult({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output: resultString,
        })
      } catch (err) {
        console.error("[v0] Tool execution error:", err instanceof Error ? err.message : err)
        addToolResult({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output: JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
        })
      }
    },

    onError: (err) => {
      console.error("[v0] AI Chat error:", err.message)
    },
  })

  // Load chat history from localStorage
  useEffect(() => {
    try {
      const localHistory = localStorage.getItem(CHAT_HISTORY_LOCAL_KEY)
      if (localHistory) {
        const localData = JSON.parse(localHistory)
        if (localData.messages && Array.isArray(localData.messages) && localData.messages.length > 0) {
          console.log("[chat] Loaded history from localStorage:", localData.messages.length, "messages")
          setMessages(localData.messages)
        }
      }
    } catch (error) {
      console.warn("[chat] Failed to load chat history:", error)
    } finally {
      setIsLoadingHistory(false)
    }
  }, [setMessages])

  const lastSaveRef = useRef<string>("")
  useEffect(() => {
    if (isLoadingHistory) return
    if (messages.length === 0) return

    // Serialize messages for comparison and storage
    // Filter out tool-related parts but keep text, file, and reasoning parts
    const serializableMessages = messages.map((msg) => {
      const anyMsg = msg as any

      // Filter parts to only serializable types (text, file, reasoning)
      // Exclude tool-* parts as they contain non-serializable data
      const serializableParts = msg.parts?.filter((part) => {
        return part.type === "text" || part.type === "file" || part.type === "reasoning"
      }).map((part) => {
        // For file parts, ensure we have the URL
        if (part.type === "file") {
          const filePart = part as any
          return {
            type: "file",
            url: filePart.url,
            filename: filePart.filename,
            mimeType: filePart.mimeType,
          }
        }
        return part
      })

      return {
        id: msg.id,
        role: msg.role,
        // For assistant messages, content might be in parts; for user, might be string
        content: anyMsg.content || "",
        createdAt: anyMsg.createdAt instanceof Date ? anyMsg.createdAt.toISOString() : anyMsg.createdAt,
        // Include serializable parts
        ...(serializableParts && serializableParts.length > 0 && { parts: serializableParts }),
      }
    })

    const messagesJson = JSON.stringify(serializableMessages)
    if (messagesJson === lastSaveRef.current) return
    lastSaveRef.current = messagesJson

    const timeoutId = setTimeout(() => {
      try {
        localStorage.setItem(CHAT_HISTORY_LOCAL_KEY, JSON.stringify({
          messages: serializableMessages,
          updatedAt: new Date().toISOString(),
        }))
        console.log("[chat] Saved to localStorage:", serializableMessages.length, "messages")
      } catch (error) {
        console.warn("[chat] Failed to save to localStorage:", error)
      }
    }, 1000)

    return () => clearTimeout(timeoutId)
  }, [messages, isLoadingHistory])

  const handleClearChat = () => {
    setMessages([])
    lastSaveRef.current = ""

    try {
      localStorage.removeItem(CHAT_HISTORY_LOCAL_KEY)
    } catch (error) {
      console.error("Failed to clear chat history on server:", error)
    }
  }

  const prevMessagesLengthRef = useRef(messages.length)
  useEffect(() => {
    // Only scroll if a new message was added, not on keyboard open/close
    if (messages.length > prevMessagesLengthRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }
    prevMessagesLengthRef.current = messages.length
  }, [messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const messageText = input.trim()
    if (!messageText && uploadedImages.length === 0) return

    setInput("")
    const imagesToSend = [...uploadedImages]
    setUploadedImages([])

    try {
      if (imagesToSend.length > 0) {
        const filesParts: FileUIPart[] = await Promise.all(
          imagesToSend.map(async (img, i) => {
            let dataUrl: string
            if (img.file) {
              dataUrl = await fileToBase64(img.file)
            } else {
              dataUrl = img.url
            }
            return {
              type: "file" as const,
              filename: img.file?.name || `image-${i}.png`,
              mediaType: (img.file?.type || "image/png") as `image/${string}`,
              url: dataUrl,
            }
          }),
        )

        console.log("[v0] Sending message with images:", imagesToSend.length)

        sendMessage({
          text: messageText || "Please analyze this image and recreate what you see.",
          files: filesParts,
        })
      } else {
        sendMessage({ text: messageText })
      }
    } catch (err) {
      console.error("[v0] Error sending message:", err)
      setInput(messageText)
      setUploadedImages(imagesToSend)
    }
  }

  const handleImageSelect = async (file: File) => {
    const url = URL.createObjectURL(file)
    setUploadedImages((prev) => [...prev, { url, file }])
  }

  const handleImagePaste = async (file: File) => {
    await handleImageSelect(file)
  }

  const handleRemoveImage = (index: number) => {
    setUploadedImages((prev) => {
      const newImages = [...prev]
      URL.revokeObjectURL(newImages[index].url)
      newImages.splice(index, 1)
      return newImages
    })
  }

  const togglePanel = () => {
    setIsOpen(!isOpen)
  }

  const isLoading = status === "streaming" || status === "submitted"

  useEffect(() => {
    if (!isMobile) return

    const handleResize = () => {
      // Update CSS variable with current viewport height
      const vh = window.visualViewport?.height || window.innerHeight
      document.documentElement.style.setProperty("--app-height", `${vh}px`)
      // Removed auto-scroll that was pushing header off-screen
    }

    handleResize()
    window.visualViewport?.addEventListener("resize", handleResize)
    window.addEventListener("resize", handleResize)

    return () => {
      window.visualViewport?.removeEventListener("resize", handleResize)
      window.removeEventListener("resize", handleResize)
    }
  }, [isMobile])

  if (!isOpen) {
    return (
      <button
        onClick={togglePanel}
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
        aria-label="Open AI Chat"
      >
        <MessageSquare className="h-6 w-6" />
      </button>
    )
  }

  return (
    <div
      ref={chatContainerRef}
      className={cn(
        "fixed z-50 flex flex-col bg-background border border-border shadow-xl",
        isMobile ? "left-0 right-0 top-0" : "bottom-4 right-4 w-96 h-[600px] max-h-[80vh] rounded-lg",
      )}
      style={isMobile ? { height: "var(--app-height, 100dvh)", maxHeight: "var(--app-height, 100dvh)" } : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border flex-shrink-0">
        <h2 className="font-semibold text-foreground">AI Diagram Assistant</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={handleClearChat}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground"
            title="Clear chat"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button onClick={togglePanel} className="p-1.5 rounded hover:bg-muted text-muted-foreground" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Model Selector */}
      <div className="px-3 py-2 border-b border-border flex-shrink-0">
        <ModelSelector
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          showMenu={showModelMenu}
          onToggleMenu={() => setShowModelMenu(!showModelMenu)}
          models={AVAILABLE_MODELS}
        />
      </div>

      {/* Messages */}
      <div className="flex-1 flex-shrink overflow-y-auto p-3 min-h-0 pb-2">
        <ChatMessages messages={messages} isLoading={isLoading} />
        <div className="h-8" />
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border flex-shrink-0 bg-background">
        <ChatInput
          input={input}
          onInputChange={setInput}
          onSubmit={handleSubmit}
          onImageSelect={handleImageSelect}
          onImagePaste={handleImagePaste}
          onRemoveImage={handleRemoveImage}
          uploadedImages={uploadedImages}
          isLoading={isLoading}
        />
      </div>

      {/* Error display */}
      {status === "error" && (
        <div className="px-3 pb-3 flex-shrink-0">
          <div className="text-sm text-destructive bg-destructive/10 rounded p-2">Error generating response. Please try again or switch models.</div>
        </div>
      )}
    </div>
  )
}
