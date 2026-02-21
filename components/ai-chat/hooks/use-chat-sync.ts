import { useEffect } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import type { UIMessage } from "@ai-sdk/react"
import type { User } from "@supabase/supabase-js"
import { chatService, type ChatSession } from "@/lib/services/chat-service"
import { debounce } from "@/lib/utils/debounce"
import { extractTitleFromMessages } from "@/lib/ai-chat/title-extractor"

type DebouncedCloudSave = ReturnType<typeof debounce<(session: ChatSession, msgs: UIMessage[]) => void>>

type StateSetter<T> = Dispatch<SetStateAction<T>>
type DbMessagePayload = ReturnType<typeof chatService.convertToDbMessage>

function getDbMessages(messages: UIMessage[]): DbMessagePayload[] {
  return messages.map((message) => chatService.convertToDbMessage(message))
}

function getMessageSignatures(messages: UIMessage[], dbMessages: DbMessagePayload[]): string[] {
  return dbMessages.map((dbMessage, index) => {
    const messageId = messages[index]?.id ?? `idx-${index}`

    return [
      messageId,
      dbMessage.role,
      dbMessage.content ?? "",
      JSON.stringify(dbMessage.parts ?? []),
      JSON.stringify(dbMessage.tool_calls ?? []),
      JSON.stringify(dbMessage.tool_results ?? []),
    ].join(":")
  })
}

function hasMatchingPrefix(prefix: string[], target: string[]): boolean {
  if (prefix.length > target.length) return false
  return prefix.every((value, index) => value === target[index])
}

type LoadChatHistoryParams = {
  user: User | null
  currentDiagramId: string | null
  selectedModel: string
  currentDiagramTitle: string | null
  setChatSession: StateSetter<ChatSession | null>
  setIsLoadingHistory: StateSetter<boolean>
  setMessages: (messages: UIMessage[]) => void
  setLastSavedToCloud: StateSetter<Date | null>
  setCloudError: StateSetter<string | null>
  updateDiagramTitle: (title: string) => Promise<void>
  invalidatePendingCloudSaves: () => void
  getMessagesFingerprint: (messages: UIMessage[]) => string
  lastSavedMessagesRef: MutableRefObject<string>
  persistedMessageSignaturesRef: MutableRefObject<Map<string, string[]>>
  localStorageKey: string
}

export function useLoadChatHistory({
  user,
  currentDiagramId,
  selectedModel,
  currentDiagramTitle,
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
  localStorageKey,
}: LoadChatHistoryParams) {
  useEffect(() => {
    let isCancelled = false

    const loadHistory = async () => {
      invalidatePendingCloudSaves()
      setIsLoadingHistory(true)

      // If user is logged in, try to load from Supabase.
      if (user) {
        try {
          const session = await chatService.getOrCreateSession(currentDiagramId, selectedModel)
          if (isCancelled) return
          setChatSession(session)

          const dbMessages = await chatService.getMessages(session.id)
          if (isCancelled) return

          const aiMessages = dbMessages.length > 0 ? chatService.convertFromDbMessages(dbMessages) : []
          setMessages(aiMessages)
          lastSavedMessagesRef.current = getMessagesFingerprint(aiMessages)
          persistedMessageSignaturesRef.current.set(
            session.id,
            getMessageSignatures(aiMessages, getDbMessages(aiMessages)),
          )

          if (dbMessages.length > 0) {
            setLastSavedToCloud(new Date())
          }

          // Auto-name session and diagram if they're still default and we have messages.
          if (dbMessages.length > 0) {
            const extractedTitle = extractTitleFromMessages(aiMessages)

            if (extractedTitle) {
              const titleUpdatePromises: Promise<unknown>[] = []

              if (session.title === "New Chat") {
                titleUpdatePromises.push(chatService.updateSession(session.id, { title: extractedTitle }))
              }

              if (currentDiagramTitle === "Untitled Diagram") {
                titleUpdatePromises.push(updateDiagramTitle(extractedTitle))
              }

              if (titleUpdatePromises.length > 0) {
                await Promise.allSettled(titleUpdatePromises)
              }
            }
          }

          if (isCancelled) return
          setCloudError(null)
          setIsLoadingHistory(false)
          return
        } catch (error) {
          if (!isCancelled) {
            console.warn("[chat] Failed to load from Supabase, falling back to localStorage:", error)
            setCloudError("Failed to sync with cloud")
          }
        }
      }

      // Fallback to localStorage.
      try {
        const localHistory = localStorage.getItem(localStorageKey)
        if (localHistory) {
          const localData = JSON.parse(localHistory) as { messages?: UIMessage[] }
          const localMessages = Array.isArray(localData.messages) ? localData.messages : []
          if (!isCancelled) {
            setMessages(localMessages)
            lastSavedMessagesRef.current = getMessagesFingerprint(localMessages)
          }
        } else if (!isCancelled) {
          setMessages([])
          lastSavedMessagesRef.current = ""
        }
        if (!user) {
          persistedMessageSignaturesRef.current.clear()
        }
      } catch (error) {
        if (!isCancelled) {
          console.warn("[chat] Failed to load chat history:", error)
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingHistory(false)
        }
      }
    }

    void loadHistory()

    return () => {
      isCancelled = true
    }
  }, [
    user,
    currentDiagramId,
    selectedModel,
    currentDiagramTitle,
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
    localStorageKey,
  ])
}

type DebouncedCloudSaveParams = {
  saveToSupabaseRef: MutableRefObject<DebouncedCloudSave | null>
  cloudSaveQueueRef: MutableRefObject<Promise<void>>
  latestCloudSaveRequestRef: MutableRefObject<number>
  setIsSavingToCloud: StateSetter<boolean>
  setCloudError: StateSetter<string | null>
  setLastSavedToCloud: StateSetter<Date | null>
  persistedMessageSignaturesRef: MutableRefObject<Map<string, string[]>>
  saveDebounceMs: number
}

export function useDebouncedCloudSave({
  saveToSupabaseRef,
  cloudSaveQueueRef,
  latestCloudSaveRequestRef,
  setIsSavingToCloud,
  setCloudError,
  setLastSavedToCloud,
  persistedMessageSignaturesRef,
  saveDebounceMs,
}: DebouncedCloudSaveParams) {
  useEffect(() => {
    saveToSupabaseRef.current = debounce((session: ChatSession, msgs: UIMessage[]) => {
      if (!session || msgs.length === 0) return

      const requestId = ++latestCloudSaveRequestRef.current

      cloudSaveQueueRef.current = cloudSaveQueueRef.current
        .catch(() => {
          // Keep save queue alive after failures.
        })
        .then(async () => {
          if (requestId !== latestCloudSaveRequestRef.current) {
            return
          }

          setIsSavingToCloud(true)
          setCloudError(null)

          try {
            const dbMessages = getDbMessages(msgs)
            const nextSignatures = getMessageSignatures(msgs, dbMessages)
            const previousSignatures = persistedMessageSignaturesRef.current.get(session.id) ?? []
            let didWrite = false

            // Fast path: conversation grew and prior saved messages are an unchanged prefix.
            if (previousSignatures.length > 0 && hasMatchingPrefix(previousSignatures, nextSignatures)) {
              if (nextSignatures.length > previousSignatures.length) {
                await chatService.saveMessages(session.id, dbMessages.slice(previousSignatures.length))
                didWrite = true
              }
            } else if (previousSignatures.length === 0) {
              // New session with no known cloud messages yet.
              if (dbMessages.length > 0) {
                await chatService.saveMessages(session.id, dbMessages)
                didWrite = true
              }
            } else {
              // Fallback when existing messages changed in-place (edit/regeneration).
              await chatService.clearMessages(session.id)
              if (dbMessages.length > 0) {
                await chatService.saveMessages(session.id, dbMessages)
              }
              didWrite = true
            }

            persistedMessageSignaturesRef.current.set(session.id, nextSignatures)

            if (didWrite && requestId === latestCloudSaveRequestRef.current) {
              setLastSavedToCloud(new Date())
            }
          } catch (error) {
            console.error("[chat] Failed to save to Supabase:", error)
            if (requestId === latestCloudSaveRequestRef.current) {
              setCloudError("Failed to save to cloud")
            }
          } finally {
            if (requestId === latestCloudSaveRequestRef.current) {
              setIsSavingToCloud(false)
            }
          }
        })
    }, saveDebounceMs)

    return () => {
      saveToSupabaseRef.current?.cancel()
      latestCloudSaveRequestRef.current += 1
    }
  }, [
    saveToSupabaseRef,
    cloudSaveQueueRef,
    latestCloudSaveRequestRef,
    setIsSavingToCloud,
    setCloudError,
    setLastSavedToCloud,
    persistedMessageSignaturesRef,
    saveDebounceMs,
  ])
}

type PersistMessagesParams = {
  messages: UIMessage[]
  isLoadingHistory: boolean
  user: User | null
  chatSession: ChatSession | null
  saveToSupabaseRef: MutableRefObject<DebouncedCloudSave | null>
  lastSavedMessagesRef: MutableRefObject<string>
  getMessagesFingerprint: (messages: UIMessage[]) => string
  localStorageKey: string
}

const serializeMessages = (messages: UIMessage[]) =>
  messages.map((msg) => {
    const msgWithContent = msg as UIMessage & { content?: string; createdAt?: Date | string }
    const serializableParts = msg.parts
      ?.filter((part) => part.type === "text" || part.type === "file" || part.type === "reasoning")
      .map((part) => {
        if (part.type === "file") {
          const filePart = part as { type: "file"; url?: string; filename?: string; mimeType?: string }
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
      content: msgWithContent.content || "",
      createdAt: msgWithContent.createdAt instanceof Date ? msgWithContent.createdAt.toISOString() : msgWithContent.createdAt,
      ...(serializableParts && serializableParts.length > 0 && { parts: serializableParts }),
    }
  })

export function usePersistMessagesOnChange({
  messages,
  isLoadingHistory,
  user,
  chatSession,
  saveToSupabaseRef,
  lastSavedMessagesRef,
  getMessagesFingerprint,
  localStorageKey,
}: PersistMessagesParams) {
  useEffect(() => {
    if (isLoadingHistory) return
    if (messages.length === 0) return

    const messagesJson = getMessagesFingerprint(messages)
    if (messagesJson === lastSavedMessagesRef.current) return
    lastSavedMessagesRef.current = messagesJson

    if (user && chatSession) {
      saveToSupabaseRef.current?.(chatSession, messages)
    }

    const timeoutId = setTimeout(() => {
      try {
        localStorage.setItem(
          localStorageKey,
          JSON.stringify({
            messages: serializeMessages(messages),
            updatedAt: new Date().toISOString(),
          }),
        )
      } catch (error) {
        console.warn("[chat] Failed to save to localStorage:", error)
      }
    }, 1000)

    return () => clearTimeout(timeoutId)
  }, [
    messages,
    isLoadingHistory,
    user,
    chatSession,
    saveToSupabaseRef,
    lastSavedMessagesRef,
    getMessagesFingerprint,
    localStorageKey,
  ])
}
