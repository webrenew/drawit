# AI SDK v6 Migration & Backend Refactoring Plan

## Executive Summary

This document outlines a comprehensive plan to:
1. Migrate Drawit from AI SDK v5 to AI SDK v6 (beta)
2. **Replace Vercel Blob + localStorage with Supabase**
3. **Add Google Authentication for user accounts**
4. Restructure the agent/tool architecture for improved maintainability and UX

---

## Current Architecture Analysis

### Pain Points

#### AI SDK (v5)
1. **Client-Side Tool Execution**: Tools defined server-side but executed client-side
2. **Tight Coupling**: Tool definitions disconnected from handlers
3. **No Multi-Step Reasoning**: Agent can only execute one tool per response cycle

#### Storage (Vercel Blob + localStorage)
1. **No User Accounts**: Chat history tied to browser session, not user
2. **Data Loss Risk**: localStorage cleared on browser reset
3. **No Cross-Device Sync**: Users can't access diagrams from different devices
4. **Limited Querying**: Vercel Blob is key-value only, no relational queries
5. **Cost**: Blob storage costs scale poorly vs. database

### Current Data Flow
```
User → localStorage (session) → Vercel Blob (backup)
           ↓
    No authentication
    No user identity
    No diagram persistence
```

---

## Target Architecture

### New Data Flow
```
User → Google OAuth → Supabase Auth → User Session
                                           ↓
                                    Supabase Database
                                    ├── users
                                    ├── diagrams
                                    ├── chat_sessions
                                    └── chat_messages
```

### Tech Stack Changes

| Component | Current | Target |
|-----------|---------|--------|
| Auth | None | Supabase Auth (Google OAuth) |
| Chat History | Vercel Blob + localStorage | Supabase `chat_messages` |
| Diagram Storage | localStorage only | Supabase `diagrams` |
| User Data | None | Supabase `users` |
| AI SDK | v5 | v6 (beta) |

---

## Phase 0: Supabase Setup (Week 0)

### 0.1 Create Supabase Project
1. Create project at [supabase.com](https://supabase.com)
2. Note down:
   - Project URL: `https://xxxx.supabase.co`
   - Anon Key: `eyJ...`
   - Service Role Key: `eyJ...` (for server-side)

### 0.2 Configure Google OAuth
1. Go to Supabase Dashboard → Authentication → Providers
2. Enable Google provider
3. Create Google Cloud OAuth credentials:
   - Authorized redirect URI: `https://xxxx.supabase.co/auth/v1/callback`
4. Add Client ID and Secret to Supabase

### 0.3 Database Schema

```sql
-- migrations/001_initial_schema.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Diagrams table
CREATE TABLE public.diagrams (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Diagram',
  elements JSONB NOT NULL DEFAULT '[]',
  connections JSONB NOT NULL DEFAULT '[]',
  viewport JSONB DEFAULT '{"x": 0, "y": 0, "zoom": 1}',
  theme TEXT DEFAULT 'dark',
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat sessions table
CREATE TABLE public.chat_sessions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  diagram_id UUID REFERENCES public.diagrams(id) ON DELETE SET NULL,
  title TEXT,
  model TEXT DEFAULT 'anthropic/claude-opus-4.5',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat messages table
CREATE TABLE public.chat_messages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id UUID REFERENCES public.chat_sessions(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT,
  parts JSONB, -- For AI SDK v5/v6 message parts
  tool_calls JSONB,
  tool_results JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_diagrams_user_id ON public.diagrams(user_id);
CREATE INDEX idx_chat_sessions_user_id ON public.chat_sessions(user_id);
CREATE INDEX idx_chat_messages_session_id ON public.chat_messages(session_id);
CREATE INDEX idx_diagrams_updated_at ON public.diagrams(updated_at DESC);

-- Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagrams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Policies: Users can only access their own data
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can view own diagrams" ON public.diagrams
  FOR SELECT USING (auth.uid() = user_id OR is_public = TRUE);

CREATE POLICY "Users can insert own diagrams" ON public.diagrams
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own diagrams" ON public.diagrams
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own diagrams" ON public.diagrams
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own chat sessions" ON public.chat_sessions
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view own chat messages" ON public.chat_messages
  FOR ALL USING (
    session_id IN (
      SELECT id FROM public.chat_sessions WHERE user_id = auth.uid()
    )
  );

-- Function to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### 0.4 Environment Variables

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Remove these:
# BLOB_READ_WRITE_TOKEN (deprecated)
```

---

## Phase 1: Authentication & User System (Week 1)

### 1.1 Install Dependencies

```bash
pnpm add @supabase/supabase-js @supabase/ssr
pnpm remove @vercel/blob  # Remove Vercel Blob
```

### 1.2 Supabase Client Setup

```typescript
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

```typescript
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}
```

### 1.3 Auth Provider Component

```typescript
// components/auth-provider.tsx
'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
```

### 1.4 Auth Callback Route

```typescript
// app/auth/callback/route.ts
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`);
}
```

### 1.5 Login UI Component

```typescript
// components/auth/login-button.tsx
'use client';

import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function LoginButton() {
  const { user, isLoading, signInWithGoogle, signOut } = useAuth();

  if (isLoading) {
    return <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />;
  }

  if (!user) {
    return (
      <Button onClick={signInWithGoogle} variant="outline" size="sm">
        <GoogleIcon className="w-4 h-4 mr-2" />
        Sign in with Google
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.user_metadata.avatar_url} />
            <AvatarFallback>{user.email?.[0].toUpperCase()}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled className="font-normal">
          {user.email}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={signOut}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

---

## Phase 2: Diagram Persistence (Week 2)

### 2.1 Diagram Service

```typescript
// lib/services/diagram-service.ts
import { createClient } from '@/lib/supabase/client';
import type { CanvasElement, SmartConnection } from '@/lib/types';

export interface Diagram {
  id: string;
  user_id: string;
  title: string;
  elements: CanvasElement[];
  connections: SmartConnection[];
  viewport: { x: number; y: number; zoom: number };
  theme: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export class DiagramService {
  private supabase = createClient();

  async list(): Promise<Diagram[]> {
    const { data, error } = await this.supabase
      .from('diagrams')
      .select('*')
      .order('updated_at', { ascending: false });
    
    if (error) throw error;
    return data;
  }

  async get(id: string): Promise<Diagram | null> {
    const { data, error } = await this.supabase
      .from('diagrams')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) return null;
    return data;
  }

  async create(diagram: Partial<Diagram>): Promise<Diagram> {
    const { data: { user } } = await this.supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await this.supabase
      .from('diagrams')
      .insert({
        user_id: user.id,
        title: diagram.title || 'Untitled Diagram',
        elements: diagram.elements || [],
        connections: diagram.connections || [],
        viewport: diagram.viewport || { x: 0, y: 0, zoom: 1 },
        theme: diagram.theme || 'dark',
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async update(id: string, updates: Partial<Diagram>): Promise<Diagram> {
    const { data, error } = await this.supabase
      .from('diagrams')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('diagrams')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }

  // Auto-save with debounce (called from Zustand store)
  async autoSave(id: string, elements: CanvasElement[], connections: SmartConnection[]): Promise<void> {
    await this.update(id, { elements, connections });
  }
}

export const diagramService = new DiagramService();
```

### 2.2 Update Zustand Store

```typescript
// lib/store.ts (updated)
import { create } from 'zustand';
import { diagramService } from '@/lib/services/diagram-service';
import debounce from 'lodash.debounce';

interface CanvasStore {
  // ... existing state
  diagramId: string | null;
  isSaving: boolean;
  lastSaved: Date | null;
  
  // New actions
  loadDiagram: (id: string) => Promise<void>;
  saveDiagram: () => Promise<void>;
  createNewDiagram: () => Promise<string>;
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  // ... existing implementation
  
  diagramId: null,
  isSaving: false,
  lastSaved: null,

  loadDiagram: async (id) => {
    const diagram = await diagramService.get(id);
    if (diagram) {
      set({
        elements: diagram.elements,
        connections: diagram.connections,
        diagramId: diagram.id,
      });
    }
  },

  saveDiagram: debounce(async () => {
    const { diagramId, elements, connections } = get();
    if (!diagramId) return;
    
    set({ isSaving: true });
    try {
      await diagramService.autoSave(diagramId, elements, connections);
      set({ lastSaved: new Date() });
    } finally {
      set({ isSaving: false });
    }
  }, 2000), // Debounce 2 seconds

  createNewDiagram: async () => {
    const diagram = await diagramService.create({});
    set({ 
      diagramId: diagram.id,
      elements: [],
      connections: [],
    });
    return diagram.id;
  },
}));
```

### 2.3 Diagram List Page

```typescript
// app/diagrams/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { diagramService, type Diagram } from '@/lib/services/diagram-service';
import { DiagramCard } from '@/components/diagrams/diagram-card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function DiagramsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [diagrams, setDiagrams] = useState<Diagram[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && user) {
      diagramService.list().then(setDiagrams).finally(() => setIsLoading(false));
    }
  }, [user, authLoading]);

  const handleCreateNew = async () => {
    const diagram = await diagramService.create({});
    router.push(`/diagram/${diagram.id}`);
  };

  if (!user) {
    return <div>Please sign in to view your diagrams</div>;
  }

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">My Diagrams</h1>
        <Button onClick={handleCreateNew}>
          <Plus className="w-4 h-4 mr-2" />
          New Diagram
        </Button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {diagrams.map((diagram) => (
          <DiagramCard key={diagram.id} diagram={diagram} />
        ))}
      </div>
    </div>
  );
}
```

---

## Phase 3: Chat History Migration (Week 3)

### 3.1 Chat Service

```typescript
// lib/services/chat-service.ts
import { createClient } from '@/lib/supabase/client';
import type { UIMessage } from 'ai';

export interface ChatSession {
  id: string;
  user_id: string;
  diagram_id: string | null;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  parts: any[] | null;
  tool_calls: any[] | null;
  tool_results: any[] | null;
  created_at: string;
}

export class ChatService {
  private supabase = createClient();

  // Sessions
  async createSession(diagramId?: string): Promise<ChatSession> {
    const { data: { user } } = await this.supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await this.supabase
      .from('chat_sessions')
      .insert({
        user_id: user.id,
        diagram_id: diagramId || null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getSession(id: string): Promise<ChatSession | null> {
    const { data } = await this.supabase
      .from('chat_sessions')
      .select('*')
      .eq('id', id)
      .single();
    return data;
  }

  async listSessions(diagramId?: string): Promise<ChatSession[]> {
    let query = this.supabase
      .from('chat_sessions')
      .select('*')
      .order('updated_at', { ascending: false });
    
    if (diagramId) {
      query = query.eq('diagram_id', diagramId);
    }

    const { data } = await query;
    return data || [];
  }

  // Messages
  async getMessages(sessionId: string): Promise<UIMessage[]> {
    const { data } = await this.supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    return (data || []).map(this.dbMessageToUIMessage);
  }

  async saveMessage(sessionId: string, message: UIMessage): Promise<void> {
    const { error } = await this.supabase
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role: message.role,
        content: typeof message.content === 'string' ? message.content : null,
        parts: message.parts || null,
      });

    if (error) throw error;

    // Update session timestamp
    await this.supabase
      .from('chat_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId);
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.supabase
      .from('chat_messages')
      .delete()
      .eq('session_id', sessionId);
  }

  private dbMessageToUIMessage(msg: ChatMessage): UIMessage {
    return {
      id: msg.id,
      role: msg.role as any,
      content: msg.content || '',
      parts: msg.parts || undefined,
    };
  }
}

export const chatService = new ChatService();
```

### 3.2 Update AI Chat Panel

```typescript
// components/ai-chat-panel.tsx (updated)
import { chatService } from '@/lib/services/chat-service';
import { useAuth } from '@/components/auth-provider';

export function AIChatPanel({ diagramId, ...props }: AIChatPanelProps) {
  const { user } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  // Initialize or load chat session
  useEffect(() => {
    if (!user) {
      setIsLoadingHistory(false);
      return;
    }

    async function initSession() {
      // Try to find existing session for this diagram
      const sessions = await chatService.listSessions(diagramId);
      
      if (sessions.length > 0) {
        setSessionId(sessions[0].id);
        const messages = await chatService.getMessages(sessions[0].id);
        setMessages(messages);
      } else {
        // Create new session
        const session = await chatService.createSession(diagramId);
        setSessionId(session.id);
      }
      
      setIsLoadingHistory(false);
    }

    initSession();
  }, [user, diagramId]);

  // Save messages to Supabase instead of Blob/localStorage
  useEffect(() => {
    if (!sessionId || messages.length === 0) return;
    
    const lastMessage = messages[messages.length - 1];
    chatService.saveMessage(sessionId, lastMessage);
  }, [messages, sessionId]);

  // ... rest of component
}
```

---

## Phase 4: AI SDK v6 Migration (Week 4)

### 4.1 Update Dependencies

```bash
pnpm add ai@6.0.0-beta @ai-sdk/gateway@3.0.0 @ai-sdk/react@3.0.0
```

### 4.2 New Tool Structure

```
lib/
├── tools/
│   ├── index.ts
│   ├── diagram-tools.ts
│   ├── shape-tools.ts
│   └── canvas-tools.ts
├── services/
│   ├── canvas-service.ts
│   ├── diagram-service.ts
│   └── chat-service.ts
└── supabase/
    ├── client.ts
    └── server.ts
```

### 4.3 Updated API Route with Multi-Step Reasoning

```typescript
// app/api/ai-chat/route.ts
import { streamText, stepCountIs } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { diagramTools } from '@/lib/tools/diagram-tools';

export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { messages, diagramId, canvasState, theme } = await req.json();

  const result = await streamText({
    model: gateway('anthropic/claude-opus-4.5'),
    system: getSystemPrompt(theme, canvasState),
    messages,
    stopWhen: stepCountIs(5),
    tools: {
      ...diagramTools,
    },
  });

  return result.toUIMessageStreamResponse();
}
```

---

## Phase 5: Cleanup & Testing (Week 5)

### 5.1 Remove Deprecated Code

- [x] Delete `app/api/chat-history/route.ts` ✅ Deleted
- [x] Remove `@vercel/blob` from `package.json` ✅ Removed
- [x] Remove `BLOB_READ_WRITE_TOKEN` from environment ✅ Done
- [ ] Remove localStorage fallback logic from `ai-chat-panel.tsx` (keep for offline support)
- [ ] Delete `app/api/upload/route.ts` (needs reimplementation with Supabase Storage)

### 5.2 Test Cases

- [ ] Google OAuth sign in/out flow
- [ ] Profile creation on first sign in
- [ ] Diagram CRUD operations
- [ ] Chat session creation and message persistence
- [ ] Cross-device sync (sign in on different browser)
- [ ] RLS policies (can't access other users' data)
- [ ] AI tool execution with authenticated context

### 5.3 Migration Script for Existing Users

```typescript
// scripts/migrate-localstorage.ts
// Run client-side to migrate existing localStorage data to Supabase

async function migrateLocalStorage() {
  const localData = localStorage.getItem('drawit-canvas');
  if (!localData) return;

  const { elements, connections } = JSON.parse(localData);
  
  // Create a new diagram with the localStorage data
  const diagram = await diagramService.create({
    title: 'Migrated from Local Storage',
    elements,
    connections,
  });

  // Clear localStorage after successful migration
  localStorage.removeItem('drawit-canvas');
  
  return diagram.id;
}
```

---

## New Dependencies

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "@supabase/ssr": "^0.5.0",
    "ai": "^6.0.0-beta",
    "@ai-sdk/gateway": "^3.0.0",
    "@ai-sdk/react": "^3.0.0"
  }
}
```

**Removed:**
- `@vercel/blob`

---

## Environment Variables

```bash
# Required (NEW)
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Required (EXISTING)
AI_GATEWAY_API_KEY=...

# Deprecated (REMOVE)
# BLOB_READ_WRITE_TOKEN
```

---

## Timeline Summary

| Week | Phase | Deliverables |
|------|-------|--------------|
| 0 | Supabase Setup | Project, OAuth, schema, RLS |
| 1 | Authentication | Google OAuth, auth provider, UI |
| 2 | Diagram Storage | Diagram service, auto-save, list page |
| 3 | Chat History | Chat service, session management |
| 4 | AI SDK v6 | Tool refactor, multi-step reasoning |
| 5 | Cleanup | Remove Blob, testing, migration |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data loss during migration | High | Keep localStorage as readonly backup for 30 days |
| Supabase cold start latency | Medium | Use connection pooling, edge functions |
| OAuth redirect issues | Medium | Test across browsers, handle errors gracefully |
| RLS policy errors | High | Extensive testing, use service role for admin |

---

## Success Metrics

1. **Auth Conversion**: > 50% of active users sign in
2. **Data Persistence**: 0 reported data loss incidents
3. **Cross-Device Usage**: > 20% of users access from multiple devices
4. **Query Performance**: < 100ms for diagram load
5. **Auto-Save Reliability**: > 99.9% successful saves

---

*Last Updated: December 8, 2025*
*Author: AI Assistant*
*Status: Phase 4 Complete - In Production*

---

## Implementation Status

### ✅ Completed

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0: Supabase Setup | ✅ Complete | Schema, RLS, triggers, realtime enabled |
| Phase 1: Authentication | ✅ Complete | Google OAuth working |
| Phase 2: Diagram Persistence | ✅ Complete | Auto-save, DiagramPicker UI |
| Phase 3: Chat History | ✅ Complete | ChatService, ChatHistorySheet UI |
| Phase 4: AI Tool Refactor | ✅ Complete | Tools moved to `lib/tools/` |
| Phase 5: Trigger.dev Integration | ✅ Complete | Server-side execution via Quick Create |
| Phase 6: System Prompt Architecture | ✅ Complete | Layered contract pattern |

### ⏳ Pending

| Task | Status | Notes |
|------|--------|-------|
| Image upload with Supabase Storage | Pending | Currently disabled |
| Remove localStorage fallback | Deferred | Keep for offline support |

### System Prompt Architecture

The system prompt in `app/api/ai-chat/route.ts` uses a **layered contract architecture**:

| Module | Purpose |
|--------|---------|
| ROLE & MISSION | Agent identity and primary objective |
| CANVAS STATE | Dynamic context injection (center, dimensions, theme) |
| TOOL REGISTRY | Decision matrix with "Use When" guidance for all 15 tools |
| TOOL GOVERNANCE | Mandatory workflow, color rules, connection rules, multi-step limits |
| NODE TYPES REFERENCE | Quick lookup for valid enum values |
| COMMUNICATION CONTRACT | Response structure + tone guidelines |
| IMAGE RECREATION | Step-by-step protocol for recreating uploaded images |
| COMMON PATTERNS | User intent → tool sequence mapping |
| HARD CONSTRAINTS | Inviolable rules (always connect, always check state, etc.) |

**Key Improvements:**
- **Tool Decision Matrix** - Clear "Use When" guidance prevents misuse of `createShape` over diagram tools
- **Mandatory Workflow** - Enforces `getCanvasState` first, connections always, colors per-node
- **Common Patterns** - Pre-mapped user intents to tool sequences reduce reasoning errors
- **Hard Constraints** - Explicit "never do X" rules catch common failures
- **Node Type Reference** - Inline enum values prevent hallucinated types

### Architecture Decision: Hybrid Tool Execution

We implemented a **hybrid approach** with two modes:

#### 1. Client-Side (Streaming Chat) - Default
- Uses AI SDK v5 `useChat` with `sendAutomaticallyWhen`
- Tools execute client-side via `onToolCall`
- Real-time streaming responses
- Best for: Interactive conversations, quick edits

#### 2. Server-Side (Trigger.dev) - Quick Create
- Uses Trigger.dev background tasks
- Tools execute server-side with `generateText` + `execute`
- Better reliability, longer timeouts (5 mins)
- Best for: Complex diagrams, batch generation

### Trigger.dev Integration

Files created:
- `src/trigger/ai-diagram.ts` - Background task with server-side tools
- `app/api/ai-diagram/route.ts` - Trigger endpoint
- `app/api/ai-diagram/[runId]/route.ts` - Polling endpoint
- `hooks/use-ai-diagram.ts` - React hook for triggering/polling
- `components/ai-quick-create.tsx` - Quick Create UI component

The Quick Create button (bottom-left, wand icon) uses Trigger.dev for:
- Flowchart templates
- Network diagrams
- Mind maps
- Org charts
- Custom prompts
