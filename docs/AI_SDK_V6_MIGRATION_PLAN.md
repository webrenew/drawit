# AI SDK v6 Migration & Tool Refactoring Plan

## Executive Summary

This document outlines a comprehensive plan to migrate Drawit from AI SDK v5 to AI SDK v6 (beta), fundamentally restructuring the agent/tool architecture for improved maintainability, UX, and server-side execution capabilities.

---

## Current Architecture Analysis

### Pain Points (v5)

1. **Client-Side Tool Execution**: Tools are defined server-side but executed client-side via `onToolCall` callback
2. **Tight Coupling**: Tool definitions in route.ts are disconnected from handlers in `/lib/ai-chat/tool-handlers/`
3. **Schema Duplication**: Zod schemas defined separately from handler logic
4. **No Server-Side Execution**: Cannot perform database operations, API calls, or file operations during tool execution
5. **Complex State Passing**: Must pass canvas state, theme, and refs through context objects
6. **No Multi-Step Reasoning**: Agent can only execute one tool per response cycle

### Current Flow
```
User → Chat Panel → API Route (streamText) → Model → Tool Call
                                                          ↓
                                              Client-Side onToolCall
                                                          ↓
                                              Handler Execution
                                                          ↓
                                              Canvas Mutation
```

---

## AI SDK v6 Key Changes

### 1. Server-Side Tool Execution
Tools can now include an `execute` function that runs server-side:

```typescript
const weatherTool = tool({
  description: 'Get weather for a location',
  inputSchema: z.object({ location: z.string() }),
  execute: async ({ location }) => {
    // Runs on server - can call APIs, databases, etc.
    return { temperature: 72, condition: 'sunny' };
  },
});
```

### 2. Multi-Step Reasoning
New `stopWhen` parameter enables agentic loops:

```typescript
const result = await generateText({
  model: gateway('anthropic/claude-opus-4.5'),
  prompt: userMessage,
  stopWhen: stepCountIs(5), // Allow up to 5 reasoning steps
  tools: { ... },
});
```

### 3. Independent Tool Definitions
Tools can be defined in separate modules and composed:

```typescript
// tools/diagram-tools.ts
export const diagramTools = {
  createFlowchart: tool({ ... }),
  createOrgChart: tool({ ... }),
};

// route.ts
import { diagramTools } from '@/tools/diagram-tools';
const result = streamText({ tools: { ...diagramTools, ...shapeTools } });
```

---

## Migration Plan

### Phase 1: Tool Architecture Refactor (Week 1)

#### 1.1 Create New Tool Structure
```
lib/
├── tools/                          # NEW: Centralized tool definitions
│   ├── index.ts                    # Tool registry & exports
│   ├── canvas-tools.ts             # Canvas state & manipulation
│   ├── diagram-tools.ts            # Diagram generators
│   ├── shape-tools.ts              # Shape CRUD operations
│   └── style-tools.ts              # Style modification tools
├── ai-chat/
│   ├── tool-handlers/              # DEPRECATED: Move to tools/
│   └── types.ts                    # Shared types
```

#### 1.2 Unified Tool Definition Pattern
Each tool file exports a `tool()` with co-located schema and execute:

```typescript
// lib/tools/diagram-tools.ts
import { tool } from 'ai';
import { z } from 'zod';
import { CanvasService } from '@/lib/services/canvas-service';

export const createFlowchartTool = tool({
  description: 'Create a flowchart with connected nodes.',
  inputSchema: z.object({
    steps: z.array(z.object({
      id: z.string(),
      type: z.enum(['start', 'end', 'process', 'decision']),
      label: z.string(),
      strokeColor: z.string().optional(),
      backgroundColor: z.string().optional(),
    })),
    connections: z.array(z.object({
      from: z.string(),
      to: z.string(),
      label: z.string().optional(),
    })),
    direction: z.enum(['vertical', 'horizontal']).optional(),
  }),
  // Server-side execution (v6)
  execute: async (args, { canvasService }) => {
    const result = await canvasService.createFlowchart(args);
    return JSON.stringify(result);
  },
});

export const diagramTools = {
  createFlowchart: createFlowchartTool,
  createOrgChart: createOrgChartTool,
  createERDiagram: createERDiagramTool,
  createNetworkDiagram: createNetworkDiagramTool,
  createMindMap: createMindMapTool,
  createMolecule: createMoleculeTool,
};
```

#### 1.3 Canvas Service Layer
Create a service class to encapsulate canvas operations:

```typescript
// lib/services/canvas-service.ts
export class CanvasService {
  private elements: CanvasElement[] = [];
  private connections: SmartConnection[] = [];
  private theme: string;
  
  constructor(initialState: { elements: CanvasElement[], connections: SmartConnection[], theme: string }) {
    this.elements = initialState.elements;
    this.connections = initialState.connections;
    this.theme = initialState.theme;
  }
  
  createFlowchart(args: CreateFlowchartInput): FlowchartResult {
    // Layout calculation
    // Element creation
    // Connection creation
    return { elements: newElements, connections: newConnections };
  }
  
  getChanges(): { elements: CanvasElement[], connections: SmartConnection[] } {
    return { elements: this.elements, connections: this.connections };
  }
}
```

---

### Phase 2: API Route Restructure (Week 2)

#### 2.1 New Route Architecture
```typescript
// app/api/ai-chat/route.ts
import { generateText, streamText, stepCountIs } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { diagramTools } from '@/lib/tools/diagram-tools';
import { shapeTools } from '@/lib/tools/shape-tools';
import { canvasTools } from '@/lib/tools/canvas-tools';
import { CanvasService } from '@/lib/services/canvas-service';

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages, canvasState, theme } = await req.json();
  
  // Initialize canvas service with current state
  const canvasService = new CanvasService({
    elements: canvasState.elements,
    connections: canvasState.connections,
    theme,
  });
  
  const result = await streamText({
    model: gateway('anthropic/claude-opus-4.5'),
    system: getSystemPrompt(theme, canvasState),
    messages,
    stopWhen: stepCountIs(5), // Enable multi-step reasoning
    tools: {
      ...diagramTools,
      ...shapeTools,
      ...canvasTools,
    },
    // Pass service to tool execution context
    toolContext: { canvasService },
  });
  
  // Return stream with canvas changes
  return result.toUIMessageStreamResponse({
    // Include canvas changes in response metadata
    sendDataStreamPart: (part) => {
      if (part.type === 'finish') {
        return { canvasChanges: canvasService.getChanges() };
      }
      return part;
    },
  });
}
```

#### 2.2 Hybrid Execution Mode
Some tools MUST run client-side (canvas mutations). Use a hybrid approach:

```typescript
// Server-executable tools (v6 style)
const analyzeCanvasTool = tool({
  description: 'Analyze the current diagram',
  inputSchema: z.object({}),
  execute: async (args, { canvasService }) => {
    return canvasService.analyze();
  },
});

// Client-only tools (still need onToolCall)
const createShapeTool = tool({
  description: 'Create a shape on canvas',
  inputSchema: z.object({ ... }),
  // No execute - handled client-side
});
```

---

### Phase 3: UX Improvements (Week 3)

#### 3.1 Progressive Tool Results
Show tool execution progress in UI:

```typescript
// components/ai-chat/tool-progress.tsx
export function ToolProgress({ toolName, status, result }: ToolProgressProps) {
  return (
    <div className="tool-progress">
      <div className="tool-header">
        {getToolIcon(toolName)}
        <span>{getToolDisplayName(toolName)}</span>
        <StatusBadge status={status} />
      </div>
      {status === 'executing' && <Spinner />}
      {status === 'complete' && <ToolResultPreview result={result} />}
    </div>
  );
}
```

#### 3.2 Tool Confirmation Mode
Allow users to preview and confirm tool actions:

```typescript
const createFlowchartTool = tool({
  description: 'Create a flowchart',
  inputSchema: z.object({ ... }),
  // Return preview, don't execute immediately
  execute: async (args) => {
    const preview = generateFlowchartPreview(args);
    return { 
      type: 'preview',
      preview,
      confirmationRequired: true,
    };
  },
});
```

#### 3.3 Undo/Redo Integration
Track tool executions for undo:

```typescript
// After each tool execution
canvasStore.pushToHistory({
  action: 'tool-execution',
  toolName: 'createFlowchart',
  before: previousState,
  after: currentState,
});
```

#### 3.4 Smart Tool Selection
Improve tool descriptions and add examples:

```typescript
const createFlowchartTool = tool({
  description: `Create a flowchart diagram with connected nodes.
    
WHEN TO USE:
- User asks for a flowchart, process flow, or decision tree
- User describes a sequence of steps with decisions
- User wants to visualize a workflow

EXAMPLE REQUESTS:
- "Create a flowchart for user authentication"
- "Draw a process flow for order fulfillment"
- "Make a decision tree for loan approval"`,
  inputSchema: z.object({ ... }),
});
```

---

### Phase 4: Testing & Rollout (Week 4)

#### 4.1 Test Cases
- [ ] Unit tests for each tool's execute function
- [ ] Integration tests for multi-step reasoning
- [ ] E2E tests for complete diagram generation flows
- [ ] Performance benchmarks (v5 vs v6)
- [ ] Error handling and recovery

#### 4.2 Feature Flags
```typescript
// lib/feature-flags.ts
export const AI_SDK_V6_ENABLED = process.env.NEXT_PUBLIC_AI_SDK_V6 === 'true';
```

#### 4.3 Gradual Rollout
1. Deploy v6 behind feature flag
2. A/B test with 10% of users
3. Monitor error rates and performance
4. Increase rollout percentage
5. Full migration

---

## Tool Inventory & Refactoring Notes

### Current Tools (Prioritized)

| Tool | Server-Exec? | Priority | Notes |
|------|-------------|----------|-------|
| `getCanvasState` | ✅ Yes | P0 | Pure read, no side effects |
| `createFlowchart` | Hybrid | P0 | Layout server-side, mutations client |
| `createNetworkDiagram` | Hybrid | P0 | Fix schema mismatch (done) |
| `createOrgChart` | Hybrid | P1 | |
| `createERDiagram` | Hybrid | P1 | |
| `createMindMap` | Hybrid | P1 | |
| `createMolecule` | Hybrid | P2 | |
| `createShape` | ❌ Client | P1 | Direct canvas mutation |
| `updateShape` | ❌ Client | P1 | Direct canvas mutation |
| `updateStyles` | ❌ Client | P1 | Direct canvas mutation |
| `clearCanvas` | ❌ Client | P2 | Direct canvas mutation |
| `analyzeDiagram` | ✅ Yes | P2 | Pure computation |
| `beautifyDiagram` | Hybrid | P2 | |
| `placeImage` | Hybrid | P2 | Image processing server-side |

### New Tools to Add

| Tool | Description | Priority |
|------|-------------|----------|
| `exportDiagram` | Export as PNG/SVG/JSON | P1 |
| `importDiagram` | Import from JSON/image | P1 |
| `suggestImprovements` | AI-powered diagram feedback | P2 |
| `convertDiagram` | Convert between diagram types | P2 |
| `groupElements` | Group selected elements | P3 |
| `alignElements` | Auto-align elements | P3 |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| v6 beta instability | High | Feature flag, fallback to v5 |
| Breaking changes in v6 GA | Medium | Pin versions, monitor changelog |
| Performance regression | Medium | Benchmark, lazy load tools |
| Client/server state sync | High | Optimistic updates, conflict resolution |

---

## Success Metrics

1. **Tool Execution Time**: < 500ms for simple tools, < 2s for diagram generation
2. **Multi-Step Success Rate**: > 90% of multi-step tasks complete successfully
3. **User Satisfaction**: Improvement in diagram quality ratings
4. **Error Rate**: < 1% tool execution failures
5. **Code Maintainability**: Tool definitions < 50 lines each, single responsibility

---

## Dependencies

```json
{
  "ai": "^6.0.0-beta",
  "@ai-sdk/gateway": "^3.0.0",
  "@ai-sdk/react": "^3.0.0"
}
```

---

## Timeline

| Week | Phase | Deliverables |
|------|-------|--------------|
| 1 | Tool Architecture | New tool structure, canvas service |
| 2 | API Restructure | v6 route, hybrid execution |
| 3 | UX Improvements | Progress UI, confirmations, undo |
| 4 | Testing & Rollout | Tests, feature flags, gradual rollout |

---

## Next Steps

1. [ ] Review and approve this plan
2. [ ] Create feature branch `feat/ai-sdk-v6`
3. [ ] Set up v6 beta dependencies in parallel
4. [ ] Begin Phase 1: Tool architecture refactor
5. [ ] Schedule weekly sync to review progress

---

*Last Updated: December 8, 2025*
*Author: AI Assistant*
*Status: Draft - Pending Review*

