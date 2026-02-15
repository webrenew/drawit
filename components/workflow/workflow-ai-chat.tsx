"use client"

import type React from "react"

import { useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MessageCircle, Send, X, Loader2, Bot, User } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WorkflowCanvasHandle } from "./workflow-canvas"
import type { WorkflowConfig } from "@/lib/workflow-types"

interface WorkflowAIChatProps {
  canvasRef: React.RefObject<WorkflowCanvasHandle | null>
}

interface CreateWorkflowToolResult {
  success?: boolean
  message?: string
  nodeIds?: string[]
  error?: string
}

const generateEdgeId = () => `edge_${crypto.randomUUID()}`
export function WorkflowAIChat({ canvasRef }: WorkflowAIChatProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [localInput, setLocalInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

  const { messages, status, sendMessage, addToolResult } = useChat({
    transport: new DefaultChatTransport({ api: "/api/ai-chat" }),
    async onToolCall({ toolCall }) {
      if (toolCall.toolName === "createWorkflow") {
        const input = toolCall.input as {
          nodes: WorkflowConfig["nodes"]
          edges?: WorkflowConfig["edges"]
          connections?: WorkflowConfig["connections"]
          autoLayout?: boolean
        }

        try {
          const canvas = canvasRef.current
          if (!canvas) {
            throw new Error("Workflow canvas is not mounted on this page.")
          }

          const edges =
            input.edges && input.edges.length
              ? input.edges
              : (input.connections || []).map((connection) => ({
                  id: generateEdgeId(),
                  source: connection.from,
                  target: connection.to,
                  label: connection.label,
                  animated: connection.animated ?? true,
                }))

          canvas.addWorkflow({ nodes: input.nodes, edges }, input.autoLayout ?? true)

          addToolResult({
            tool: "createWorkflow",
            toolCallId: toolCall.toolCallId,
            output: {
              success: true,
              message: `Created workflow with ${input.nodes.length} nodes and ${edges.length} connections`,
              nodeIds: input.nodes.map((n) => n.id),
            },
          })
        } catch (error) {
          addToolResult({
            tool: "createWorkflow",
            toolCallId: toolCall.toolCallId,
            output: {
              success: false,
              error: String(error),
            },
          })
        }
      }
    },
  })

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!localInput.trim()) return

    sendMessage({ text: localInput })
    setLocalInput("")
  }

  const isLoading = status === "streaming" || status === "submitted"

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        size="icon"
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-[100]"
      >
        <MessageCircle className="h-6 w-6" />
      </Button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[500px] bg-background border border-border rounded-xl shadow-2xl flex flex-col z-[100]">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <span className="font-semibold">Workflow AI</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-8">
              <p>Ask me to create workflows!</p>
              <p className="mt-2 text-xs">
                Try: &quot;Create a workflow that fetches data from an API, transforms it, and saves to database&quot;
              </p>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={cn("flex gap-2", message.role === "user" ? "justify-end" : "justify-start")}
            >
              {message.role === "assistant" && (
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}

              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                  message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {message.parts?.map((part, i) => {
                  if (part.type === "text") {
                    return <span key={i}>{part.text}</span>
                  }
                  if (part.type === "tool-createWorkflow") {
                    if (part.state === "output-available") {
                      const result = part.output as CreateWorkflowToolResult
                      return (
                        <div key={i} className="mt-2 p-2 bg-green-500/10 rounded text-xs">
                          {result?.success
                            ? `Created ${result.nodeIds?.length || 0} nodes`
                            : `Error: ${result?.error || "Unknown error"}`}
                        </div>
                      )
                    }
                    if (part.state === "input-available") {
                      return (
                        <div key={i} className="mt-2 p-2 bg-blue-500/10 rounded text-xs">
                          Creating workflow...
                        </div>
                      )
                    }
                  }
                  return null
                })}
              </div>

              {message.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                  <User className="h-4 w-4 text-primary-foreground" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
              </div>
              <div className="bg-muted rounded-lg px-3 py-2">
                <span className="text-sm text-muted-foreground">Thinking...</span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <form onSubmit={onSubmit} className="p-4 border-t border-border">
        <div className="flex gap-2">
          <Textarea
            value={localInput}
            onChange={(e) => setLocalInput(e.target.value)}
            placeholder="Describe your workflow..."
            className="min-h-[44px] max-h-32 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                onSubmit(e)
              }
            }}
          />
          <Button type="submit" size="icon" disabled={isLoading || !localInput.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  )
}
