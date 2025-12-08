import { createClient } from "@/lib/supabase/client"
import type { UIMessage } from "@ai-sdk/react"

export interface ChatSession {
  id: string
  user_id: string
  diagram_id: string | null
  title: string | null
  model: string
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  session_id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string | null
  parts: unknown[] | null
  tool_calls: unknown[] | null
  tool_results: unknown[] | null
  created_at: string
}

export type ChatSessionCreate = Pick<ChatSession, "title" | "model"> & {
  diagram_id?: string | null
}

interface MessagePart {
  type: string
  [key: string]: unknown
}

class ChatService {
  private getClient() {
    return createClient()
  }

  // ============================================
  // SESSION OPERATIONS
  // ============================================

  async listSessions(diagramId?: string): Promise<ChatSession[]> {
    const supabase = this.getClient()
    let query = supabase
      .from("chat_sessions")
      .select("*")
      .order("updated_at", { ascending: false })

    if (diagramId) {
      query = query.eq("diagram_id", diagramId)
    }

    const { data, error } = await query
    if (error) throw error
    return data ?? []
  }

  async getSession(id: string): Promise<ChatSession | null> {
    const supabase = this.getClient()
    const { data, error } = await supabase
      .from("chat_sessions")
      .select("*")
      .eq("id", id)
      .single()

    if (error) {
      if (error.code === "PGRST116") return null
      throw error
    }
    return data
  }

  async createSession(session: ChatSessionCreate): Promise<ChatSession> {
    const supabase = this.getClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) throw new Error("Not authenticated")

    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({
        user_id: user.id,
        diagram_id: session.diagram_id || null,
        title: session.title || "New Chat",
        model: session.model || "anthropic/claude-opus-4.5",
      })
      .select()
      .single()

    if (error) throw error
    return data
  }

  async updateSession(id: string, updates: Partial<ChatSession>): Promise<ChatSession> {
    const supabase = this.getClient()
    const { data, error } = await supabase
      .from("chat_sessions")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single()

    if (error) throw error
    return data
  }

  async deleteSession(id: string): Promise<void> {
    const supabase = this.getClient()
    const { error } = await supabase.from("chat_sessions").delete().eq("id", id)
    if (error) throw error
  }

  // ============================================
  // MESSAGE OPERATIONS
  // ============================================

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const supabase = this.getClient()
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })

    if (error) throw error
    return data ?? []
  }

  async saveMessage(
    sessionId: string,
    message: {
      role: "user" | "assistant" | "system" | "tool"
      content?: string | null
      parts?: unknown[] | null
      tool_calls?: unknown[] | null
      tool_results?: unknown[] | null
    }
  ): Promise<ChatMessage> {
    const supabase = this.getClient()
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({
        session_id: sessionId,
        role: message.role,
        content: message.content || null,
        parts: message.parts || null,
        tool_calls: message.tool_calls || null,
        tool_results: message.tool_results || null,
      })
      .select()
      .single()

    if (error) throw error

    // Update session's updated_at
    await this.updateSession(sessionId, {})

    return data
  }

  async saveMessages(
    sessionId: string,
    messages: Array<{
      role: "user" | "assistant" | "system" | "tool"
      content?: string | null
      parts?: unknown[] | null
      tool_calls?: unknown[] | null
      tool_results?: unknown[] | null
    }>
  ): Promise<ChatMessage[]> {
    if (messages.length === 0) return []

    const supabase = this.getClient()
    const { data, error } = await supabase
      .from("chat_messages")
      .insert(
        messages.map((msg) => ({
          session_id: sessionId,
          role: msg.role,
          content: msg.content || null,
          parts: msg.parts || null,
          tool_calls: msg.tool_calls || null,
          tool_results: msg.tool_results || null,
        }))
      )
      .select()

    if (error) throw error

    // Update session's updated_at
    await this.updateSession(sessionId, {})

    return data ?? []
  }

  async clearMessages(sessionId: string): Promise<void> {
    const supabase = this.getClient()
    const { error } = await supabase
      .from("chat_messages")
      .delete()
      .eq("session_id", sessionId)

    if (error) throw error
  }

  // ============================================
  // HELPER: Convert AI SDK messages to DB format
  // ============================================

  convertToDbMessage(message: UIMessage): {
    role: "user" | "assistant" | "system" | "tool"
    content: string | null
    parts: unknown[] | null
    tool_calls: unknown[] | null
    tool_results: unknown[] | null
  } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyMsg = message as any

    // Extract serializable parts (text, file, reasoning only)
    const serializableParts = message.parts?.filter((part: MessagePart) => {
      return part.type === "text" || part.type === "file" || part.type === "reasoning"
    }).map((part: MessagePart) => {
      if (part.type === "file") {
        return {
          type: "file",
          url: part.url,
          filename: part.filename,
          mimeType: part.mimeType,
        }
      }
      return part
    })

    // Extract tool calls from parts
    const toolCalls = message.parts?.filter((part: MessagePart) => part.type === "tool-invocation").map((part: MessagePart) => {
      return {
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: part.args,
        state: part.state,
      }
    })

    return {
      role: message.role as "user" | "assistant" | "system" | "tool",
      content: anyMsg.content || null,
      parts: serializableParts && serializableParts.length > 0 ? serializableParts : null,
      tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : null,
      tool_results: null, // Tool results are in the tool-invocation parts with state: "result"
    }
  }

  // ============================================
  // HELPER: Convert DB messages back to AI SDK format
  // ============================================

  convertFromDbMessages(dbMessages: ChatMessage[]): UIMessage[] {
    return dbMessages.map((dbMsg) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const message: any = {
        id: dbMsg.id,
        role: dbMsg.role,
        content: dbMsg.content || "",
        createdAt: new Date(dbMsg.created_at),
      }

      // Reconstruct parts if available
      if (dbMsg.parts && Array.isArray(dbMsg.parts)) {
        message.parts = dbMsg.parts
      }

      return message as UIMessage
    })
  }

  // ============================================
  // HELPER: Get or create session for current user/diagram
  // ============================================

  async getOrCreateSession(diagramId?: string | null, model?: string): Promise<ChatSession> {
    const supabase = this.getClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) throw new Error("Not authenticated")

    // Try to find existing session for this diagram (or general session)
    let query = supabase
      .from("chat_sessions")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)

    if (diagramId) {
      query = query.eq("diagram_id", diagramId)
    } else {
      query = query.is("diagram_id", null)
    }

    const { data: existing } = await query.single()

    if (existing) {
      return existing
    }

    // Create new session
    return this.createSession({
      diagram_id: diagramId || null,
      title: "New Chat",
      model: model || "anthropic/claude-opus-4.5",
    })
  }
}

// Singleton instance
export const chatService = new ChatService()
