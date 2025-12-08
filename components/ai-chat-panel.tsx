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
import { MessageSquare, X, Trash2, Cloud, CloudOff, Loader2 } from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { nanoid } from "nanoid"
import type { FileUIPart } from "ai"
import type { UIMessage } from "@ai-sdk/react"
import { useAuth } from "@/components/auth-provider"
import { chatService, type ChatSession } from "@/lib/services/chat-service"
import { debounce } from "@/lib/utils/debounce"

// Types and constants
import type { ToolHandlerContext, ShapeRegistry, ShapeDataRegistry, AIChatPanelProps } from "@/lib/ai-chat/types"
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "@/lib/ai-chat/types"
import { getCanvasInfo } from "@/lib/ai-chat/canvas-helpers"
import type { CanvasElement, SmartConnection } from "@/lib/types"

// UI Components
import { ChatMessages } from "@/components/ai-chat/chat-messages"
import { ChatInput, type UploadedImage } from "@/components/ai-chat/chat-input"
import { ModelSelector } from "@/components/ai-chat/model-selector"
import { ChatHistorySheet } from "@/components/chat-history-sheet"

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
const SAVE_DEBOUNCE_MS = 2000

export function AIChatPanel({ onPreviewChange, canvasDimensions, onElementsCreated }: AIChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState("")
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([])
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  
  // Supabase chat state
  const [chatSession, setChatSession] = useState<ChatSession | null>(null)
  const [isSavingToCloud, setIsSavingToCloud] = useState(false)
  const [lastSavedToCloud, setLastSavedToCloud] = useState<Date | null>(null)
  const [cloudError, setCloudError] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const { resolvedTheme } = useTheme()
  const isMobile = useIsMobile()
  const { user } = useAuth()
  const currentDiagramId = useCanvasStore((state) => state.currentDiagramId)

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

  // ============================================
  // LOAD CHAT HISTORY
  // ============================================
  useEffect(() => {
    const loadHistory = async () => {
      setIsLoadingHistory(true)
      
      // If user is logged in, try to load from Supabase
      if (user) {
        try {
          // Get or create session for current diagram
          const session = await chatService.getOrCreateSession(currentDiagramId, selectedModel)
          setChatSession(session)
          
          // Load messages from Supabase
          const dbMessages = await chatService.getMessages(session.id)
          if (dbMessages.length > 0) {
            const aiMessages = chatService.convertFromDbMessages(dbMessages)
            setMessages(aiMessages)
            console.log("[chat] Loaded", dbMessages.length, "messages from Supabase")
            setLastSavedToCloud(new Date())
          }
          setIsLoadingHistory(false)
          return
        } catch (error) {
          console.warn("[chat] Failed to load from Supabase, falling back to localStorage:", error)
          setCloudError("Failed to sync with cloud")
        }
      }
      
      // Fallback to localStorage
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
    }

    loadHistory()
  }, [user, currentDiagramId, selectedModel, setMessages])

  // ============================================
  // SAVE MESSAGES TO SUPABASE (debounced)
  // ============================================
  const saveToSupabaseRef = useRef<ReturnType<typeof debounce> | null>(null)
  const lastSavedMessagesRef = useRef<string>("")
  
  useEffect(() => {
    // Create debounced save function
    saveToSupabaseRef.current = debounce(async (session: ChatSession, msgs: UIMessage[]) => {
      if (!session || msgs.length === 0) return
      
      setIsSavingToCloud(true)
      setCloudError(null)
      
      try {
        // Clear existing messages and save all current ones
        // This is simpler than trying to diff - Supabase is fast
        await chatService.clearMessages(session.id)
        
        const dbMessages = msgs.map((msg) => chatService.convertToDbMessage(msg))
        await chatService.saveMessages(session.id, dbMessages)
        
        setLastSavedToCloud(new Date())
        console.log("[chat] Saved", msgs.length, "messages to Supabase")
      } catch (error) {
        console.error("[chat] Failed to save to Supabase:", error)
        setCloudError("Failed to save to cloud")
      } finally {
        setIsSavingToCloud(false)
      }
    }, SAVE_DEBOUNCE_MS)
    
    return () => {
      saveToSupabaseRef.current?.cancel()
    }
  }, [])

  // ============================================
  // SAVE MESSAGES ON CHANGE
  // ============================================
  useEffect(() => {
    if (isLoadingHistory) return
    if (messages.length === 0) return

    const messagesJson = JSON.stringify(messages.map(m => ({ id: m.id, role: m.role })))
    if (messagesJson === lastSavedMessagesRef.current) return
    lastSavedMessagesRef.current = messagesJson

    // Save to Supabase if logged in
    if (user && chatSession) {
      saveToSupabaseRef.current?.(chatSession, messages)
    }

    // Always save to localStorage as backup
    const timeoutId = setTimeout(() => {
      try {
        const serializableMessages = messages.map((msg) => {
          const anyMsg = msg as any
          const serializableParts = msg.parts?.filter((part) => {
            return part.type === "text" || part.type === "file" || part.type === "reasoning"
          }).map((part) => {
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
            content: anyMsg.content || "",
            createdAt: anyMsg.createdAt instanceof Date ? anyMsg.createdAt.toISOString() : anyMsg.createdAt,
            ...(serializableParts && serializableParts.length > 0 && { parts: serializableParts }),
          }
        })

        localStorage.setItem(CHAT_HISTORY_LOCAL_KEY, JSON.stringify({
          messages: serializableMessages,
          updatedAt: new Date().toISOString(),
        }))
      } catch (error) {
        console.warn("[chat] Failed to save to localStorage:", error)
      }
    }, 1000)

    return () => clearTimeout(timeoutId)
  }, [messages, isLoadingHistory, user, chatSession])

  // ============================================
  // CLEAR CHAT
  // ============================================
  const handleClearChat = async () => {
    setMessages([])
    lastSavedMessagesRef.current = ""

    // Clear from Supabase
    if (user && chatSession) {
      try {
        await chatService.clearMessages(chatSession.id)
        setLastSavedToCloud(new Date())
      } catch (error) {
        console.error("[chat] Failed to clear chat from Supabase:", error)
      }
    }

    // Clear from localStorage
    try {
      localStorage.removeItem(CHAT_HISTORY_LOCAL_KEY)
    } catch (error) {
      console.error("[chat] Failed to clear chat history:", error)
    }
  }

  // ============================================
  // SELECT SESSION FROM HISTORY
  // ============================================
  const handleSelectSession = async (session: ChatSession) => {
    setIsLoadingHistory(true)
    try {
      setChatSession(session)
      const dbMessages = await chatService.getMessages(session.id)
      const aiMessages = chatService.convertFromDbMessages(dbMessages)
      setMessages(aiMessages)
      lastSavedMessagesRef.current = JSON.stringify(aiMessages.map(m => ({ id: m.id, role: m.role })))
      setLastSavedToCloud(new Date())
      console.log("[chat] Loaded session:", session.id, "with", dbMessages.length, "messages")
    } catch (error) {
      console.error("[chat] Failed to load session:", error)
      setCloudError("Failed to load chat")
    } finally {
      setIsLoadingHistory(false)
    }
  }

  // ============================================
  // START NEW CHAT
  // ============================================
  const handleNewChat = async () => {
    setMessages([])
    lastSavedMessagesRef.current = ""
    setChatSession(null)
    setLastSavedToCloud(null)
    setCloudError(null)
    
    // Clear localStorage
    try {
      localStorage.removeItem(CHAT_HISTORY_LOCAL_KEY)
    } catch (error) {
      console.error("[chat] Failed to clear localStorage:", error)
    }

    // Create new session if logged in
    if (user) {
      try {
        const newSession = await chatService.createSession({
          diagram_id: currentDiagramId || null,
          title: "New Chat",
          model: selectedModel,
        })
        setChatSession(newSession)
        console.log("[chat] Created new session:", newSession.id)
      } catch (error) {
        console.error("[chat] Failed to create new session:", error)
      }
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
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-foreground">AI Diagram Assistant</h2>
          {/* Cloud sync indicator */}
          {user && (
            <div className="flex items-center" title={
              cloudError ? cloudError : 
              isSavingToCloud ? "Saving..." : 
              lastSavedToCloud ? `Saved ${lastSavedToCloud.toLocaleTimeString()}` : 
              "Not saved yet"
            }>
              {isSavingToCloud ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : cloudError ? (
                <CloudOff className="h-3 w-3 text-destructive" />
              ) : lastSavedToCloud ? (
                <Cloud className="h-3 w-3 text-green-500" />
              ) : (
                <CloudOff className="h-3 w-3 text-muted-foreground" />
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {user && (
            <ChatHistorySheet
              currentSessionId={chatSession?.id}
              onSelectSession={handleSelectSession}
              onNewChat={handleNewChat}
            />
          )}
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
