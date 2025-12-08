# UX Code Review: Canvas Tools

**Date:** December 8, 2025  
**Reviewer:** AI UX Code Reviewer  
**Scope:** Canvas tools for diagrams, flowcharts, and sketches  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low

---

## Executive Summary

After thorough inspection of the canvas tools system, I've identified **12 critical/high-severity issues** that are likely causing the "nearly unusable" feedback from users. The root causes fall into three categories:

1. **Schema-to-Handler Mismatches** - Tool definitions don't match their handlers
2. **Missing Error Handling** - Failures occur silently without user feedback
3. **State Management Issues** - Race conditions and stale data in tool execution

---

## 🔴 Critical Issues

### 1. Org Chart Schema vs Handler Mismatch

**Location:** `lib/tools/schemas.ts` (L88-98) vs `lib/ai-chat/tool-handlers/org-chart-handler.ts` (L29-37)

**Problem:** The Zod schema and handler expect completely different data structures.

**Schema expects:**
```typescript
{
  members: Array<{ id, name, role, reportsTo? }>
}
```

**Handler expects:**
```typescript
{
  hierarchy: Array<{ id, name, title?, department?, children? }>
}
```

**User Impact:** AI will generate valid schema data that the handler cannot process. Org charts will **completely fail to render**.

**Recommendation:**
```typescript
// Option 1: Update schema to match handler
export const createOrgChartSchema = z.object({
  hierarchy: z.array(z.object({
    id: z.string(),
    name: z.string(),
    title: z.string().optional(),
    children: z.lazy(() => z.array(orgNodeSchema)).optional(),
  })),
  orientation: z.enum(["vertical", "horizontal"]).optional(),
  colorScheme: colorSchemeSchema,
})

// Option 2: Transform in handler (less ideal)
```

---

### 2. Mind Map Schema vs Handler Mismatch

**Location:** `lib/tools/schemas.ts` (L70-82) vs `lib/ai-chat/tool-handlers/diagram-handlers.ts` (L410-519)

**Problem:** `createMindMap` schema expects `centralTopic` and `branches`, but the handler calls `handleCreateDiagram` which expects `nodes` and `edges`.

**Schema expects:**
```typescript
{
  centralTopic: string,
  branches: Array<{ id, label, children? }>
}
```

**Handler receives (via `handleCreateDiagram`):**
```typescript
{
  nodes: Array<{ id, label, style? }>,
  edges: Array<{ from, to }>,
  layout: "tree" | "circular" | "grid" | "force-directed"
}
```

**User Impact:** Mind maps will **completely fail to create** because the data structure is incompatible.

**Recommendation:**
- [ ] Create dedicated `handleCreateMindMap` function
- [ ] Transform `centralTopic` + `branches` into radial tree layout

---

### 3. ER Diagram Attributes Schema Mismatch

**Location:** `lib/tools/schemas.ts` (L104-115) vs `lib/ai-chat/tool-handlers/diagram-handlers.ts` (L51-139)

**Problem:** Schema defines attributes as objects, handler expects strings.

**Schema defines:**
```typescript
attributes: z.array(z.object({
  name: z.string(),
  type: z.string(),
  isPrimaryKey: z.boolean().optional(),
}))
```

**Handler expects:**
```typescript
entity.attributes // Array<string>
entity.primaryKey  // string (attribute name)
```

**User Impact:** ER diagrams will render **without any attributes** or crash.

**Recommendation:**
```typescript
// Update handler to process schema format:
for (const attr of entity.attributes) {
  const attrText = attr.isPrimaryKey ? `🔑 ${attr.name}: ${attr.type}` : `${attr.name}: ${attr.type}`
  // ...
}
```

---

### 4. Workflow Tool Redirects to Flowchart Handler

**Location:** `components/ai-chat-panel.tsx` (L225-226)

```typescript
case "createWorkflow":
  result = handleCreateFlowchart(args, toolContext) // Wrong handler!
```

**Problem:** Workflow schema defines node types as `trigger | action | condition | loop | transform | output`, but flowchart handler expects `start | end | process | decision | data | document`.

**User Impact:** Workflows will render with **wrong shapes** (all rectangles instead of workflow-specific shapes).

**Recommendation:**
- [ ] Create dedicated `handleCreateWorkflow` function with n8n-style node rendering
- [ ] Map workflow node types to appropriate visual representations

---

## 🟠 High-Severity Issues

### 5. Image Placement Always Fails

**Location:** `lib/ai-chat/tool-handlers/image-handler.ts` (L25-78)

**Problem:** The handler checks `ctx.uploadedImagesRef` but this ref is **never passed** to the tool context.

```typescript
// In ai-chat-panel.tsx getToolContext():
const getToolContext = useCallback((): ToolHandlerContext => ({
  // uploadedImagesRef is NOT included!
  resolvedTheme,
  shapeRegistryRef,
  shapeDataRef,
  // ...
}), [/* deps */])
```

**User Impact:** When AI tries to place an uploaded image, users see: "No images have been uploaded" even when they just uploaded one.

**Recommendation:**
```typescript
// Add to getToolContext in ai-chat-panel.tsx:
const uploadedImagesRef = useRef<string[]>([])

// Update when images are uploaded
useEffect(() => {
  uploadedImagesRef.current = uploadedImages.map(img => img.url)
}, [uploadedImages])

// Include in context:
uploadedImagesRef,
```

---

### 6. Network Diagram Missing Required Parameters Validation

**Location:** `lib/ai-chat/tool-handlers/diagram-handlers.ts` (L281-304)

**Problem:** Star topology requires `centerNodeId` and tree topology requires `rootNodeId`, but validation only happens after the AI selects these topologies.

```typescript
case "star":
  if (!args.centerNodeId) {
    return { success: false, message: "Star topology requires centerNodeId parameter" }
  }
```

The schema marks these as optional, so AI often omits them.

**User Impact:** Users ask for "star topology network" and get cryptic error messages.

**Recommendation:**
```typescript
// Update schema to make conditional requirements clear:
export const createNetworkDiagramSchema = z.object({
  // ... other fields
  topology: z.enum(["star", "ring", "mesh", "tree", "bus"]),
  centerNodeId: z.string().optional()
    .describe("REQUIRED for 'star' topology - specify which node is the hub"),
  rootNodeId: z.string().optional()
    .describe("REQUIRED for 'tree' topology - specify the root/top node"),
}).refine(
  (data) => data.topology !== "star" || data.centerNodeId,
  { message: "centerNodeId is required for star topology" }
).refine(
  (data) => data.topology !== "tree" || data.rootNodeId,
  { message: "rootNodeId is required for tree topology" }
)
```

---

### 7. Canvas State Race Condition

**Location:** `components/ai-chat-panel.tsx` (L136-138, L187)

**Problem:** `elementsRef.current` is updated in a `useEffect`, but tool handlers read it immediately. During rapid tool execution, handlers see stale state.

```typescript
const elementsRef = useRef<CanvasElement[]>(elements)
useEffect(() => {
  elementsRef.current = elements
}, [elements])

// Later, in tool context:
elements: elementsRef.current, // May be stale!
```

**User Impact:** When AI creates multiple elements in quick succession:
- `getCanvasState` shows outdated element counts
- `updateStyles` misses newly created elements
- `analyzeDiagram` gives incorrect analysis

**Recommendation:**
```typescript
// Use a getter function instead:
getElements: () => useCanvasStore.getState().elements,

// In handlers:
const elements = ctx.getElements()
```

---

### 8. Shape Type "circle" Not in ToolType Union

**Location:** `lib/tools/schemas.ts` (L169) vs `lib/types.ts` (L1-13)

**Problem:** Schema accepts `circle` as a shape type, but `ToolType` union doesn't include it.

```typescript
// Schema allows:
type: z.enum(["rectangle", "circle", "diamond", "text", "arrow"])

// But ToolType is:
export type ToolType = "selection" | "hand" | "rectangle" | "ellipse" | "diamond" | "arrow" | "line" | "freedraw" | "text" | "image" | "eraser" | "connector"
// No "circle"!
```

**User Impact:** When AI creates a "circle", the element renders with `type: "circle"` which the canvas doesn't recognize, resulting in **invisible or broken shapes**.

**Recommendation:**
```typescript
// Update schema to match ToolType:
type: z.enum(["rectangle", "ellipse", "diamond", "text", "arrow", "line"])
  .describe("Shape type. Use 'ellipse' for circles.")
```

---

### 9. Flowchart Nodes Not Registered in Shape Registry

**Location:** `lib/ai-chat/tool-handlers/flowchart-handler.ts` (L117-166)

**Problem:** Generated element IDs are stored in `nodeElementIds` Map but NOT registered in `ctx.shapeRegistryRef` or `ctx.shapeDataRef` for most nodes.

```typescript
const elementId = generateId()
nodeElementIds.set(node.id, elementId)

// Missing these critical lines:
// ctx.shapeRegistryRef.current.set(node.id, elementId)
// ctx.shapeDataRef.current.set(node.id, {...})

// Only shapeDataRef is set:
ctx.shapeDataRef.current.set(node.id, { x, y, width, height, type })
```

**User Impact:** 
- Follow-up requests like "make node X blue" fail
- `updateShape` and `getShapeInfo` can't find flowchart nodes
- Users can't modify diagrams after creation

**Recommendation:**
```typescript
// Add shape registry registration:
ctx.shapeRegistryRef.current.set(node.id, elementId)
ctx.shapeDataRef.current.set(node.id, {
  x: node.x,
  y: node.y,
  width: node.width,
  height: node.height,
  type: shapeType,
})
```

---

## 🟡 Medium-Severity Issues

### 10. Silent Connection ID Validation Failure

**Location:** `lib/ai-chat/tool-handlers/flowchart-handler.ts` (L168-208)

**Problem:** When connection references invalid node IDs, they're silently skipped without warning.

```typescript
const sourceElementId = nodeElementIds.get(edge.from)
const targetElementId = nodeElementIds.get(edge.to)

if (!sourceElementId || !targetElementId) continue // Silent skip!
```

**User Impact:** Users create flowcharts with connections that mysteriously don't appear. No error message explains why.

**Recommendation:**
```typescript
if (!sourceElementId || !targetElementId) {
  console.warn(`[flowchart] Invalid connection: ${edge.from} -> ${edge.to}`)
  // Consider adding to a "skipped connections" array to report back
  continue
}
```

---

### 11. Default Canvas Centering Assumes 1200x800

**Location:** `lib/flowchart-layouts.ts` (L175-177)

```typescript
// Center around viewport center (assume 1200x800 canvas)
const startX = 600 - totalWidth / 2
const startY = 400 - totalHeight / 2
```

**Problem:** Hardcoded canvas dimensions don't match actual viewport, causing diagrams to render off-screen on smaller/larger displays.

**User Impact:** On mobile or large monitors, diagrams appear in unexpected positions.

**Recommendation:**
- Pass actual canvas dimensions from `canvasDimensions` context
- Or use the provided `centerX`/`centerY` from canvas info

---

### 12. updateStyles Opacity Scale Mismatch

**Location:** `lib/ai-chat/tool-handlers/style-handler.ts` (L115-116)

**Problem:** The schema describes opacity as "0 to 100" but `CanvasElement.opacity` uses 0 to 1.

```typescript
// Schema says:
opacity: z.number().optional().describe("Opacity from 0 to 100")

// But element uses:
opacity: 1 // meaning 100%
```

**User Impact:** AI says "set opacity to 50" → element becomes invisible (opacity 50 > 1 gets clamped or causes issues).

**Recommendation:**
```typescript
// Normalize in handler:
if (args.styles.opacity !== undefined) {
  update.opacity = args.styles.opacity > 1 ? args.styles.opacity / 100 : args.styles.opacity
}
```

---

## 🟢 Low-Severity Issues

### 13. Missing Tool Result Feedback for Large Diagrams

When diagrams successfully create many elements, the success message is generic. Users benefit from specific feedback.

**Recommendation:**
Add summary like: "Created flowchart with 8 shapes and 7 connections. Nodes: Start, Process A, Decision B..."

---

### 14. No Undo for clearCanvas

`clearCanvas` immediately removes all elements with no confirmation or undo capability.

**Recommendation:**
Consider adding confirmation step or snapshot for undo.

---

## Summary Action Items

### Immediate Fixes (Critical)
- [ ] Fix Org Chart schema/handler mismatch
- [ ] Fix Mind Map schema/handler mismatch  
- [ ] Fix ER Diagram attributes format
- [ ] Create proper Workflow handler

### Short-term Fixes (High)
- [ ] Pass `uploadedImagesRef` to tool context
- [ ] Add schema refinements for network topology requirements
- [ ] Fix canvas state race condition
- [ ] Map "circle" to "ellipse" in schemas
- [ ] Register flowchart nodes in shape registry

### Medium-term Improvements
- [ ] Add connection validation warnings
- [ ] Use actual canvas dimensions in layout calculations
- [ ] Fix opacity scale normalization
- [ ] Add better success messages
- [ ] Consider undo for destructive operations

---

## Testing Checklist

After fixes, verify these user flows work end-to-end:

- [ ] "Create an org chart with CEO, VPs, and managers"
- [ ] "Create a mind map about project planning"
- [ ] "Create a database schema for a blog with users, posts, and comments"
- [ ] "Create a workflow for email automation"
- [ ] "Place the uploaded image on the canvas"
- [ ] "Create a star network topology with server as the hub"
- [ ] "Make all shapes blue"
- [ ] "Create a flowchart, then change node A to red"
- [ ] "Set opacity to 50%"

---

*Document generated by AI UX Code Review*

