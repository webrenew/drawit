"use client"

import { MessageSquare, Loader2, Brain } from "lucide-react"
import type { UIMessage } from "ai"
import ReactMarkdown from "react-markdown"
import Image from "next/image"
import { memo, useMemo } from "react"

/**
 * Sanitize image URLs to prevent XSS attacks
 * Only allows http:, https:, and data:image/ URLs
 */
function sanitizeImageUrl(url: string | undefined): string {
  if (!url) return "/placeholder.svg"

  try {
    // Handle data URLs
    if (url.startsWith("data:")) {
      // Only allow data URLs with image MIME types
      if (url.startsWith("data:image/")) {
        return url
      }
      console.warn("[chat-messages] Blocked non-image data URL")
      return "/placeholder.svg"
    }

    // Validate URL and protocol
    const parsed = new URL(url)
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return url
    }

    // Block javascript:, file:, and other dangerous protocols
    console.warn("[chat-messages] Blocked unsafe URL protocol:", parsed.protocol)
    return "/placeholder.svg"
  } catch (error) {
    // Invalid URL
    console.warn("[chat-messages] Invalid image URL:", error)
    return "/placeholder.svg"
  }
}

interface ChatMessagesProps {
  messages: UIMessage[]
  isLoading: boolean
}

function getRenderablePartSignature(message: UIMessage): string {
  if (!message.parts || message.parts.length === 0) return ""

  return message.parts
    .filter((part) => part.type === "text" || part.type === "file")
    .map((part) => {
      if (part.type === "text") {
        return `text:${part.text}`
      }

      if (part.type === "file") {
        return `file:${part.url || ""}:${part.filename || ""}:${part.mediaType || ""}`
      }

      return ""
    })
    .join("|")
}

const AssistantMarkdown = memo(
  function AssistantMarkdown({ text }: { text: string }) {
    return (
      <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
        <ReactMarkdown>{text}</ReactMarkdown>
      </div>
    )
  },
  (prev, next) => prev.text === next.text,
)

type MessageRowProps = {
  message: UIMessage
  signature: string
}

const MessageRow = memo(
  function MessageRow({ message }: MessageRowProps) {
    return (
      <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"} mb-3`}>
        <div
          className={`max-w-[80%] rounded-lg px-4 py-2 ${
            message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
          }`}
        >
          {message.parts?.map((part, index) => {
            if (part.type === "text") {
              return message.role === "assistant" ? (
                <AssistantMarkdown key={index} text={part.text} />
              ) : (
                <p key={index} className="text-sm whitespace-pre-wrap">
                  {part.text}
                </p>
              )
            }

            if (part.type === "file") {
              const sanitizedUrl = sanitizeImageUrl(part.url)
              return (
                <div key={index} className="mt-2">
                  <Image
                    src={sanitizedUrl}
                    alt={part.filename || "Uploaded image"}
                    width={480}
                    height={320}
                    unoptimized
                    className="w-auto max-w-full h-auto rounded"
                  />
                </div>
              )
            }

            if (part.type.startsWith("tool-")) {
              return null
            }

            return null
          })}
        </div>
      </div>
    )
  },
  (prev, next) => prev.signature === next.signature && prev.message.role === next.message.role,
)

function getToolStatusMessage(toolName: string): string {
  const toolMessages: Record<string, string> = {
    getCanvasState: "Checking Canvas",
    createFlowchart: "Drawing Flowchart",
    createDiagram: "Drawing Diagram",
    createMindMap: "Drawing Mind Map",
    createOrgChart: "Drawing Org Chart",
    createShapes: "Adding Shapes",
    editElements: "Editing Elements",
    deleteElements: "Removing Elements",
    moveElements: "Moving Elements",
    connectElements: "Connecting Elements",
    styleElements: "Styling Elements",
    createTimeline: "Drawing Timeline",
    createNetworkDiagram: "Drawing Network Diagram",
  }
  return toolMessages[toolName] || `Running ${toolName}`
}

export function ChatMessages({ messages, isLoading }: ChatMessagesProps) {
  const messageRows = useMemo(
    () =>
      messages.map((message) => ({
        message,
        signature: getRenderablePartSignature(message),
      })),
    [messages],
  )

  const lastMessage = messages[messages.length - 1]
  const isAgentWorking = isLoading && lastMessage?.role === "assistant"

  const runningTools: string[] = []
  if (lastMessage?.role === "assistant" && lastMessage.parts) {
    for (const part of lastMessage.parts) {
      if (part.type.startsWith("tool-")) {
        const toolPart = part as { state?: string }
        if (toolPart.state === "input-streaming" || toolPart.state === "input-available") {
          const toolName = part.type.replace("tool-", "")
          runningTools.push(toolName)
        }
      }
    }
  }

  return (
    <>
      {messages.length === 0 && (
        <div className="text-center text-muted-foreground py-8">
          <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Ask me to create diagrams, flowcharts, or shapes!</p>
          <p className="text-xs mt-2">You can also paste or upload images for reference.</p>
        </div>
      )}

      {messageRows.map(({ message, signature }) => (
        <MessageRow key={message.id} message={message} signature={signature} />
      ))}

      {runningTools.length > 0 && (
        <div className="flex justify-start mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium animate-thinking-gradient bg-[linear-gradient(90deg,hsl(var(--foreground)/0.4),hsl(var(--foreground)),hsl(var(--foreground)/0.4))] bg-[length:200%_100%] bg-clip-text text-transparent">
              {getToolStatusMessage(runningTools[runningTools.length - 1])}
            </span>
            <span className="flex gap-[2px]">
              <span className="w-1 h-1 rounded-full bg-foreground/60 animate-bounce [animation-delay:0ms]" />
              <span className="w-1 h-1 rounded-full bg-foreground/60 animate-bounce [animation-delay:150ms]" />
              <span className="w-1 h-1 rounded-full bg-foreground/60 animate-bounce [animation-delay:300ms]" />
            </span>
          </div>
        </div>
      )}

      {isAgentWorking && runningTools.length === 0 && (
        <div className="flex justify-start mb-4">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-foreground/70 animate-pulse" />
            <span className="text-sm font-medium animate-thinking-gradient bg-[linear-gradient(90deg,hsl(var(--foreground)/0.4),hsl(var(--foreground)),hsl(var(--foreground)/0.4))] bg-[length:200%_100%] bg-clip-text text-transparent">
              Thinking
            </span>
            <span className="flex gap-[2px]">
              <span className="w-1 h-1 rounded-full bg-foreground/60 animate-bounce [animation-delay:0ms]" />
              <span className="w-1 h-1 rounded-full bg-foreground/60 animate-bounce [animation-delay:150ms]" />
              <span className="w-1 h-1 rounded-full bg-foreground/60 animate-bounce [animation-delay:300ms]" />
            </span>
          </div>
        </div>
      )}

      {isLoading && !isAgentWorking && (
        <div className="flex justify-start">
          <div className="bg-muted rounded-lg px-4 py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        </div>
      )}
    </>
  )
}
