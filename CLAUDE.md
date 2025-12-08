# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install    # Install dependencies
pnpm dev        # Run development server (localhost:3000)
pnpm build      # Build for production
pnpm lint       # Run ESLint
```

## Architecture

Drawit is an AI-powered collaborative whiteboard built with Next.js 16 (App Router), React 19, and Vercel AI SDK v5.

### Core Data Flow

1. **Canvas State** - Zustand store (`lib/store.ts`) manages `elements` (shapes) and `connections` (smart connectors) with localStorage persistence
2. **AI Integration** - Chat panel sends requests to `/api/ai-chat` which uses Vercel AI Gateway to stream tool calls
3. **Tool Execution** - Tool handlers in `lib/ai-chat/tool-handlers/` execute AI instructions client-side, directly mutating the canvas store

### Key Types (`lib/types.ts`)

- `CanvasElement` - All drawable shapes (rectangle, ellipse, diamond, arrow, line, freedraw, text, image)
- `SmartConnection` - Connectors between elements with routing types (bezier, smoothstep, straight)
- `AppState` - Current tool, selection, and default styling properties

### AI Tool System

The AI assistant has tools defined in `/api/ai-chat/route.ts` with handlers in `lib/ai-chat/tool-handlers/`:
- `getCanvasState` - Read current canvas elements/connections
- `createFlowchart`, `createWorkflow`, `createMindMap`, `createOrgChart`, `createERDiagram`, `createNetworkDiagram`, `createMolecule` - Diagram generators
- `createShape`, `updateShape`, `updateStyles` - Shape manipulation
- `clearCanvas`, `analyzeDiagram`, `beautifyDiagram` - Canvas utilities

Each diagram type has a corresponding layout algorithm in `lib/*-layouts.ts` files.

### Component Structure

- `components/editor/canvas.tsx` - Main SVG-based canvas with shape rendering, selection, pan/zoom
- `components/ai-chat-panel.tsx` - Chat interface using `@ai-sdk/react` useChat hook with tool result handling
- `components/editor/smart-connector-layer.tsx` - Connection rendering with automatic routing
- `components/ui/` - shadcn/ui components

### Environment Variables

```bash
AI_GATEWAY_API_KEY=     # Required for AI features (Vercel AI Gateway)
BLOB_READ_WRITE_TOKEN=  # Optional - Vercel Blob for chat history/images
```

### Path Aliases

`@/*` maps to project root (configured in `tsconfig.json`)
