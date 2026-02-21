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
import { MessageSquare, X, Trash2, Cloud, CloudOff, Loader2, LogIn, Sparkles, Zap } from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { nanoid } from "nanoid"
// AI SDK v6: Files are sent as File[] directly, SDK converts them to data URLs
import type { UIMessage } from "@ai-sdk/react"
import { useAuth } from "@/components/auth-provider"
import { chatService, type ChatSession } from "@/lib/services/chat-service"
import { imageService } from "@/lib/services/image-service"
import { useAIDiagram } from "@/hooks/use-ai-diagram"

// Types and constants
import type { ToolHandlerContext, ShapeRegistry, ShapeDataRegistry, AIChatPanelProps } from "@/lib/ai-chat/types"
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "@/lib/ai-chat/types"
import { getCanvasInfo } from "@/lib/ai-chat/canvas-helpers"
import type { CanvasElement, SmartConnection } from "@/lib/types"
import type { RunBackgroundDiagramArgs } from "@/lib/tools/background-tools"

// UI Components
import { ChatMessages } from "@/components/ai-chat/chat-messages"
import { ChatInput, type UploadedImage } from "@/components/ai-chat/chat-input"
import { ModelSelector } from "@/components/ai-chat/model-selector"
import { ChatHistorySheet } from "@/components/chat-history-sheet"
import {
  useDebouncedCloudSave,
  useLoadChatHistory,
  usePersistMessagesOnChange,
} from "@/components/ai-chat/hooks/use-chat-sync"

// Connection utilities for proper SmartConnection creation
import { convertBackgroundConnections } from "@/lib/ai-chat/connection-helpers"

// Title extraction for dynamic diagram naming
import { extractTitleFromMessage, extractTitleFromMessages, isDiagramCreationTool, getDefaultTitleForTool } from "@/lib/ai-chat/title-extractor"

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Map diagram element types from Trigger.dev to canvas types
function mapDiagramTypeToCanvasType(diagramType: string): CanvasElement["type"] {
  const typeMap: Record<string, CanvasElement["type"]> = {
    // Flowchart types
    start: "ellipse",
    end: "ellipse",
    process: "rectangle",
    decision: "diamond",
    data: "rectangle",
    document: "rectangle",
    // Network types
    server: "rectangle",
    database: "rectangle",
    client: "rectangle",
    router: "diamond",
    firewall: "rectangle",
    cloud: "ellipse",
    service: "rectangle",
    // Generic types
    rectangle: "rectangle",
    ellipse: "ellipse",
    diamond: "diamond",
    circle: "ellipse",
  }
  return typeMap[diagramType] || "rectangle"
}

const CHAT_HISTORY_LOCAL_KEY = "drawit-chat-history"
const SAVE_DEBOUNCE_MS = 2000
type ToolHandlersModule = typeof import("@/lib/ai-chat/tool-handlers")
const isClientDebugLoggingEnabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_CHAT_DEBUG === "1"

function debugLog(...args: unknown[]) {
  if (isClientDebugLoggingEnabled) {
    console.log(...args)
  }
}

export function AIChatPanel({ canvasDimensions }: AIChatPanelProps) {
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
  const _connections = useCanvasStore((state) => state.connections)
  const addElement = useCanvasStore((state) => state.addElement)
  const addConnection = useCanvasStore((state) => state.addConnection)
  const updateElements = useCanvasStore((state) => state.updateElements)
  const clearAll = useCanvasStore((state) => state.clearAll)
  const updateDiagramTitle = useCanvasStore((state) => state.updateDiagramTitle)
  const currentDiagram = useCanvasStore((state) => state.currentDiagram)

  // Background task hook for complex diagrams
  const { 
    status: backgroundStatus, 
    progress: backgroundProgress, 
    trigger: triggerBackground,
    error: backgroundError,
  } = useAIDiagram()

  const shapeRegistryRef = useRef<ShapeRegistry>(new Map())
  const shapeDataRef = useRef<ShapeDataRegistry>(new Map())
  const toolHandlersRef = useRef<ToolHandlersModule | null>(null)

  const getToolHandlers = useCallback(async (): Promise<ToolHandlersModule> => {
    if (!toolHandlersRef.current) {
      toolHandlersRef.current = await import("@/lib/ai-chat/tool-handlers")
    }
    return toolHandlersRef.current
  }, [])

  const elementsRef = useRef<CanvasElement[]>(elements)
  useEffect(() => {
    elementsRef.current = elements
  }, [elements])

  // Track uploaded images for placeImage tool
  const uploadedImagesRef = useRef<string[]>([])
  useEffect(() => {
    uploadedImagesRef.current = uploadedImages.map(img => img.url)
  }, [uploadedImages])

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
      uploadedImagesRef, // For placeImage tool
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
      // @deprecated - use getElements() for fresh state
      elements: elementsRef.current,
      // Issue #7 fix: Use getter to avoid race condition during rapid tool calls
      getElements: () => useCanvasStore.getState().elements,
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
      // Include current canvas state in every request so agent always knows what's on canvas
      // This is critical for new conversations or when chat history is cleared
      body: () => ({
        canvasInfo: canvasInfo,
        theme: resolvedTheme || "dark",
        elements: useCanvasStore.getState().elements,
        connections: useCanvasStore.getState().connections,
      }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,

    onToolCall: async ({ toolCall }) => {
      if (!toolCall || !toolCall.toolName) {
        console.error("[v0] Invalid tool call")
        return
      }

      debugLog("[v0] Tool call received:", toolCall.toolName)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool inputs are validated by Zod schemas at runtime
      const args = toolCall.input as any

      const toolContext = getToolContext()
      debugLog("[v0] Tool context elements count:", toolContext.elements?.length ?? 0)

      try {
        let result: unknown
        const handlers = await getToolHandlers()

        switch (toolCall.toolName) {
          case "getCanvasState":
            result = handlers.handleGetCanvasState(toolContext)
            break
          case "createFlowchart":
            result = handlers.handleCreateFlowchart(args, toolContext)
            break
          case "createWorkflow":
            result = handlers.handleCreateWorkflow(args, toolContext)
            break
          case "createMindMap":
            result = handlers.handleCreateMindMap(args, toolContext)
            break
          case "createOrgChart":
            result = handlers.handleCreateOrgChart(args, toolContext)
            break
          case "createERDiagram":
            result = handlers.handleCreateERDiagram(args, toolContext)
            break
          case "createNetworkDiagram":
            result = handlers.handleCreateNetworkDiagram(args, toolContext)
            break
          case "createMolecule":
            result = handlers.handleCreateMolecule(args, toolContext)
            break
          case "createShape":
            result = handlers.handleCreateShape(args, toolContext)
            break
          case "updateShape":
            result = handlers.handleUpdateShape(args, toolContext)
            break
          case "getShapeInfo":
            result = handlers.handleGetShapeInfo(args, toolContext)
            break
          case "placeImage":
            result = await handlers.handlePlaceImage(args, toolContext)
            break
          case "clearCanvas":
            result = handlers.handleClearCanvas(toolContext)
            break
          case "updateStyles":
            result = handlers.handleUpdateStyles(args, toolContext)
            break
          case "analyzeDiagram":
            result = handlers.handleAnalyzeDiagram(toolContext)
            break
          case "beautifyDiagram":
            result = handlers.handleBeautifyDiagram(toolContext)
            break
          case "previewDiagram":
            result = handlers.handlePreviewDiagram(args)
            break
          case "runBackgroundDiagram": {
            // Handle background diagram generation via Trigger.dev
            const bgArgs = args as RunBackgroundDiagramArgs
            debugLog("[v0] Running background diagram:", bgArgs.diagramType, bgArgs.complexity)
            
            try {
              const bgResult = await triggerBackground({
                prompt: bgArgs.prompt,
                canvasInfo: canvasInfo,
                theme: resolvedTheme || "dark",
                diagramId: currentDiagramId || undefined,
                model: selectedModel,
              })
              
              if (bgResult && bgResult.elements.length > 0) {
                const isDark = resolvedTheme === "dark"
                const defaultStroke = isDark ? "#ffffff" : "#1e1e1e"
                const defaultLabel = isDark ? "#ffffff" : "#1e1e1e"
                
                // Convert background result to canvas elements
                // Use the el.id from background task to maintain connection references
                const newElements: CanvasElement[] = bgResult.elements.map((el) => ({
                  id: el.id || nanoid(),
                  type: mapDiagramTypeToCanvasType(el.type),
                  x: el.x ?? canvasInfo.centerX,
                  y: el.y ?? canvasInfo.centerY,
                  width: el.width || 150,
                  height: el.height || 60,
                  strokeColor: el.strokeColor || defaultStroke,
                  backgroundColor: el.backgroundColor || "transparent",
                  roughness: 0,
                  strokeWidth: 2,
                  strokeStyle: "solid" as const,
                  angle: 0,
                  seed: Math.floor(Math.random() * 100000),
                  isLocked: false,
                  opacity: 100,
                  connectable: true, // Enable smart connections
                  label: el.label,
                  labelColor: defaultLabel,
                  labelFontSize: 14,
                  labelFontWeight: "500",
                  labelPadding: 10,
                }))
                
                // Clear existing and add new elements
                clearAll()
                newElements.forEach((el) => addElement(el))
                
                // Convert and add connections using shared utility
                // This properly sets pathType (not routingType), arrowHeadEnd, and auto-calculates handles
                const smartConnections = convertBackgroundConnections(
                  bgResult.connections,
                  {
                    elements: newElements,
                    strokeColor: defaultStroke,
                    isDarkMode: isDark,
                  }
                )
                
                smartConnections.forEach((conn) => {
                  addConnectionMutation(conn)
                })
                
                result = {
                  success: true,
                  elementsCreated: newElements.length,
                  connectionsCreated: smartConnections.length,
                  summary: bgResult.summary,
                }
              } else {
                result = { error: "Background task completed but no elements were created" }
              }
            } catch (bgError) {
              console.error("[v0] Background diagram error:", bgError)
              result = { error: bgError instanceof Error ? bgError.message : "Background task failed" }
            }
            break
          }
          default:
            result = { error: `Unknown tool: ${toolCall.toolName}` }
        }

        const resultString = typeof result === "string" ? result : JSON.stringify(result)
        debugLog("[v0] Tool result:", resultString.substring(0, 200))

        // Auto-name diagram and chat based on chat context when a diagram is created
        if (isDiagramCreationTool(toolCall.toolName)) {
          const resultObj = typeof result === "object" ? result as Record<string, unknown> : null
          const wasSuccessful = resultObj?.success === true || resultObj?.elementsCreated

          if (wasSuccessful) {
            const extractedTitle = extractTitleFromMessages(messages)
              || getDefaultTitleForTool(toolCall.toolName)

            // Update diagram title if it's still default
            if (currentDiagram?.title === "Untitled Diagram") {
              debugLog("[v0] Auto-naming diagram:", extractedTitle)
              updateDiagramTitle(extractedTitle).catch(err => {
                console.error("[v0] Failed to update diagram title:", err)
              })
            }

            // Update chat session title if it's still default
            if (chatSession && chatSession.title === "New Chat") {
              debugLog("[v0] Auto-naming chat session:", extractedTitle)
              chatService.updateSession(chatSession.id, { title: extractedTitle }).catch(err => {
                console.error("[v0] Failed to update chat session title:", err)
              })
            }
          }
        }

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

  const saveToSupabaseRef = useRef<
    (((session: ChatSession, msgs: UIMessage[]) => void) & { cancel: () => void; flush: () => void }) | null
  >(null)
  const lastSavedMessagesRef = useRef<string>("")
  const persistedMessageSignaturesRef = useRef<Map<string, string[]>>(new Map())
  const cloudSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const latestCloudSaveRequestRef = useRef(0)

  const invalidatePendingCloudSaves = useCallback(() => {
    latestCloudSaveRequestRef.current += 1
    saveToSupabaseRef.current?.cancel()
    setIsSavingToCloud(false)
  }, [])

  const getMessagesFingerprint = useCallback((msgs: UIMessage[]) => {
    if (msgs.length === 0) return "empty"

    const last = msgs[msgs.length - 1]
    const lastWithMeta = last as UIMessage & { content?: string; createdAt?: Date | string }

    let textPartLength = 0
    let filePartCount = 0
    let reasoningPartCount = 0
    for (const part of last.parts || []) {
      if (part.type === "text") {
        textPartLength += part.text.length
      } else if (part.type === "file") {
        filePartCount += 1
      } else if (part.type === "reasoning") {
        reasoningPartCount += 1
      }
    }

    const createdAt =
      lastWithMeta.createdAt instanceof Date ? lastWithMeta.createdAt.toISOString() : (lastWithMeta.createdAt ?? "")

    return [
      msgs.length,
      last.id,
      last.role,
      createdAt,
      lastWithMeta.content?.length ?? 0,
      last.parts?.length ?? 0,
      textPartLength,
      filePartCount,
      reasoningPartCount,
    ].join("|")
  }, [])

  const getMessageSignatures = useCallback((msgs: UIMessage[]) => {
    return msgs.map((msg) => {
      const dbMessage = chatService.convertToDbMessage(msg)
      return [
        msg.id,
        dbMessage.role,
        dbMessage.content ?? "",
        JSON.stringify(dbMessage.parts ?? []),
        JSON.stringify(dbMessage.tool_calls ?? []),
        JSON.stringify(dbMessage.tool_results ?? []),
      ].join(":")
    })
  }, [])

  useLoadChatHistory({
    user,
    currentDiagramId,
    selectedModel,
    currentDiagramTitle: currentDiagram?.title ?? null,
    setChatSession,
    setIsLoadingHistory,
    setMessages,
    setLastSavedToCloud,
    setCloudError,
    updateDiagramTitle,
    invalidatePendingCloudSaves,
    getMessagesFingerprint,
    lastSavedMessagesRef,
    persistedMessageSignaturesRef,
    localStorageKey: CHAT_HISTORY_LOCAL_KEY,
  })

  useDebouncedCloudSave({
    saveToSupabaseRef,
    cloudSaveQueueRef,
    latestCloudSaveRequestRef,
    setIsSavingToCloud,
    setCloudError,
    setLastSavedToCloud,
    persistedMessageSignaturesRef,
    saveDebounceMs: SAVE_DEBOUNCE_MS,
  })

  usePersistMessagesOnChange({
    messages,
    isLoadingHistory,
    user,
    chatSession,
    saveToSupabaseRef,
    lastSavedMessagesRef,
    getMessagesFingerprint,
    localStorageKey: CHAT_HISTORY_LOCAL_KEY,
  })

  // ============================================
  // CLEAR CHAT
  // ============================================
  const handleClearChat = async () => {
    invalidatePendingCloudSaves()
    await cloudSaveQueueRef.current.catch(() => {
      // Clearing chat should continue even if a previous save failed.
    })

    setMessages([])
    lastSavedMessagesRef.current = ""
    if (chatSession) {
      persistedMessageSignaturesRef.current.set(chatSession.id, [])
    }

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
      invalidatePendingCloudSaves()
      setChatSession(session)
      const dbMessages = await chatService.getMessages(session.id)
      const aiMessages = chatService.convertFromDbMessages(dbMessages)
      setMessages(aiMessages)
      lastSavedMessagesRef.current = getMessagesFingerprint(aiMessages)
      persistedMessageSignaturesRef.current.set(session.id, getMessageSignatures(aiMessages))
      setLastSavedToCloud(new Date())
      debugLog("[chat] Loaded session:", session.id, "with", dbMessages.length, "messages")
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
    if (chatSession) {
      persistedMessageSignaturesRef.current.set(chatSession.id, [])
    }
    invalidatePendingCloudSaves()
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
        debugLog("[chat] Created new session:", newSession.id)
        persistedMessageSignaturesRef.current.set(newSession.id, [])
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

    // Check if this is the first message in the conversation
    const isFirstMessage = messages.length === 0

    try {
      if (imagesToSend.length > 0 && user) {
        // Upload images to Supabase Storage and get public URLs
        // This is much more efficient than sending base64 in the message
        const filesToUpload = imagesToSend
          .filter(img => img.file)
          .map(img => img.file as File)

        debugLog("[v0] Uploading images to Supabase:", filesToUpload.length)

        const uploadResults = await imageService.uploadImages(filesToUpload)
        const successfulUploads = uploadResults.filter(r => r.success && r.url)

        if (successfulUploads.length === 0) {
          console.error("[v0] All image uploads failed, using base64 fallback")
          // Fallback: try with base64
          const dataUrls = await Promise.all(
            imagesToSend.map(async (img) => img.file ? await fileToBase64(img.file) : img.url)
          )
          // Update ref with base64 URLs for placeImage tool
          uploadedImagesRef.current = dataUrls
          debugLog("[v0] Updated uploadedImagesRef with", dataUrls.length, "base64 URLs (fallback)")
          
          // AI SDK v6: sendMessage uses { text, files } format
          const fileParts = imagesToSend.map((img, i) => ({
            type: "file" as const,
            mediaType: img.file?.type || "image/png",
            url: dataUrls[i],
          }))
          sendMessage({
            text: messageText || "Please analyze this image and recreate what you see.",
            files: fileParts,
          })
          return
        }

        debugLog("[v0] Images uploaded, sending URLs:", successfulUploads.length)

        // IMPORTANT: Update uploadedImagesRef with Supabase URLs for placeImage tool
        // This must happen BEFORE sending the message so AI can use these URLs
        uploadedImagesRef.current = successfulUploads.map(u => u.url!)
        debugLog("[v0] Updated uploadedImagesRef with", uploadedImagesRef.current.length, "Supabase URLs")

        // AI SDK v6: sendMessage uses { text, files } format
        const fileParts = successfulUploads.map((upload, i) => {
          const originalImg = imagesToSend[i]
          return {
            type: "file" as const,
            mediaType: originalImg?.file?.type || "image/png",
            url: upload.url!,
          }
        })

        sendMessage({
          text: messageText || "Please analyze this image and recreate what you see.",
          files: fileParts,
        })
      } else if (imagesToSend.length > 0 && !user) {
        // Not logged in - use base64 fallback
        debugLog("[v0] User not logged in, using base64 fallback")
        const dataUrls = await Promise.all(
          imagesToSend.map(async (img) => img.file ? await fileToBase64(img.file) : img.url)
        )
        // Update ref with base64 URLs for placeImage tool
        uploadedImagesRef.current = dataUrls
        debugLog("[v0] Updated uploadedImagesRef with", dataUrls.length, "base64 URLs (not logged in)")
        
        // AI SDK v6: sendMessage uses { text, files } format
        const fileParts = imagesToSend.map((img, i) => ({
          type: "file" as const,
          mediaType: img.file?.type || "image/png",
          url: dataUrls[i],
        }))
        sendMessage({
          text: messageText || "Please analyze this image and recreate what you see.",
          files: fileParts,
        })
      } else {
        sendMessage({ text: messageText })
      }

      // Auto-name diagram and chat session from first message
      if (isFirstMessage && messageText) {
        const extractedTitle = extractTitleFromMessage(messageText)
        if (extractedTitle) {
          // Update diagram title if it's still default
          if (currentDiagram?.title === "Untitled Diagram") {
            debugLog("[v0] Auto-naming diagram from first message:", extractedTitle)
            updateDiagramTitle(extractedTitle).catch(err => {
              console.error("[v0] Failed to update diagram title:", err)
            })
          }

          // Update chat session title if it's still default
          if (chatSession && chatSession.title === "New Chat") {
            debugLog("[v0] Auto-naming chat session from first message:", extractedTitle)
            chatService.updateSession(chatSession.id, { title: extractedTitle }).catch(err => {
              console.error("[v0] Failed to update chat session title:", err)
            })
          }
        }
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

  const { signInWithGoogle } = useAuth()

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

  // Show sign-in prompt for unauthenticated users
  if (!user) {
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
          <button onClick={togglePanel} className="p-1.5 rounded hover:bg-muted text-muted-foreground" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sign-in prompt */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Sign in to use AI</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-[250px]">
            Create diagrams, flowcharts, and more with AI assistance. Sign in to get started.
          </p>
          <button
            onClick={signInWithGoogle}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
          >
            <LogIn className="w-4 h-4" />
            Sign in with Google
          </button>
          <p className="text-xs text-muted-foreground mt-4">
            Free to use • No credit card required
          </p>
        </div>
      </div>
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
        </div>
        <div className="flex items-center gap-1">
          <ChatHistorySheet
            currentSessionId={chatSession?.id}
            currentDiagramId={currentDiagramId}
            onSelectSession={handleSelectSession}
            onNewChat={handleNewChat}
          />
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
      <div className="flex-1 flex-shrink overflow-y-auto p-3 min-h-0 pb-2 scrollbar-geist">
        <ChatMessages messages={messages} isLoading={isLoading} />
        
        {/* Background processing indicator */}
        {(backgroundStatus === "triggering" || backgroundStatus === "running") && (
          <div className="flex items-center gap-2 p-3 my-2 bg-primary/10 rounded-lg border border-primary/20">
            <Zap className="h-4 w-4 text-primary animate-pulse" />
            <div className="flex-1">
              <p className="text-sm font-medium text-primary">Background Processing</p>
              <p className="text-xs text-muted-foreground">{backgroundProgress || "Generating complex diagram..."}</p>
            </div>
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </div>
        )}
        
        {backgroundError && (
          <div className="flex items-center gap-2 p-3 my-2 bg-destructive/10 rounded-lg border border-destructive/20">
            <p className="text-sm text-destructive">{backgroundError}</p>
          </div>
        )}
        
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
