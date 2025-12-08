"use client"

import { useState, useEffect, useCallback } from "react"
import { useAuth } from "@/components/auth-provider"
import { chatService, type ChatSession } from "@/lib/services/chat-service"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import {
  History,
  MessageSquare,
  Trash2,
  Edit2,
  Plus,
  Loader2,
  Clock,
  MoreHorizontal,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatDistanceToNow } from "date-fns"

interface ChatHistorySheetProps {
  currentSessionId?: string | null
  onSelectSession: (session: ChatSession) => void
  onNewChat: () => void
}

export function ChatHistorySheet({
  currentSessionId,
  onSelectSession,
  onNewChat,
}: ChatHistorySheetProps) {
  const { user } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")

  // Load sessions when sheet opens
  const loadSessions = useCallback(async () => {
    if (!user) return
    setIsLoading(true)
    try {
      const data = await chatService.listSessions()
      setSessions(data)
    } catch (error) {
      console.error("Failed to load chat sessions:", error)
    } finally {
      setIsLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (isOpen && user) {
      loadSessions()
    }
  }, [isOpen, user, loadSessions])

  const handleSelectSession = (session: ChatSession) => {
    onSelectSession(session)
    setIsOpen(false)
  }

  const handleNewChat = () => {
    onNewChat()
    setIsOpen(false)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await chatService.deleteSession(deleteTarget.id)
      setSessions((prev) => prev.filter((s) => s.id !== deleteTarget.id))
      // If we deleted the current session, start new chat
      if (currentSessionId === deleteTarget.id) {
        onNewChat()
      }
    } catch (error) {
      console.error("Failed to delete session:", error)
    } finally {
      setDeleteTarget(null)
    }
  }

  const handleRename = async (id: string) => {
    const title = editTitle.trim()
    if (!title) {
      setEditingId(null)
      return
    }
    try {
      await chatService.updateSession(id, { title })
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title } : s))
      )
    } catch (error) {
      console.error("Failed to rename session:", error)
    } finally {
      setEditingId(null)
      setEditTitle("")
    }
  }

  // Get message count for display (would need to add this to service)
  const getSessionSubtitle = (session: ChatSession) => {
    const time = formatDistanceToNow(new Date(session.updated_at), { addSuffix: true })
    return time
  }

  if (!user) {
    return null
  }

  return (
    <>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            title="Chat History"
          >
            <History className="w-4 h-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-80 sm:w-96">
          <SheetHeader>
            <SheetTitle>Chat History</SheetTitle>
            <SheetDescription>
              Your previous conversations with the AI assistant
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            {/* New Chat Button */}
            <Button
              onClick={handleNewChat}
              className="w-full gap-2"
              variant="outline"
            >
              <Plus className="w-4 h-4" />
              New Chat
            </Button>

            {/* Sessions List */}
            <ScrollArea className="h-[calc(100vh-220px)]">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No chat history yet</p>
                  <p className="text-sm">Start a conversation above</p>
                </div>
              ) : (
                <div className="space-y-2 pr-4">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`group flex items-center gap-2 p-3 rounded-lg border transition-colors hover:bg-muted/50 ${
                        currentSessionId === session.id
                          ? "border-primary bg-primary/5"
                          : "border-transparent"
                      }`}
                    >
                      {editingId === session.id ? (
                        <Input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(session.id)
                            if (e.key === "Escape") setEditingId(null)
                          }}
                          onBlur={() => handleRename(session.id)}
                          autoFocus
                          className="flex-1"
                        />
                      ) : (
                        <>
                          <button
                            onClick={() => handleSelectSession(session)}
                            className="flex-1 text-left min-w-0"
                          >
                            <div className="flex items-center gap-2">
                              <MessageSquare className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                              <span className="font-medium truncate">
                                {session.title || "Untitled Chat"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1 ml-6">
                              <Clock className="w-3 h-3" />
                              {getSessionSubtitle(session)}
                            </div>
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditingId(session.id)
                                  setEditTitle(session.title || "")
                                }}
                              >
                                <Edit2 className="w-4 h-4 mr-2" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(session)}
                                className="text-destructive"
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.title || "this chat"}&quot;? 
              All messages will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

