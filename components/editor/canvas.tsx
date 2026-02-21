"use client"

import React from "react"
import dynamic from "next/dynamic"
import { useState, useRef, useEffect, useCallback } from "react"
import { Toolbar } from "./toolbar"
import { PropertiesPanel } from "./properties-panel"
import { ThemeToggle } from "@/components/theme-toggle"
import { LoginButton } from "@/components/auth/login-button"
import { DiagramPicker } from "@/components/diagram-picker"
// import { AIChatPanel } from "@/components/ai-chat-panel" // Removed this import
import { useTheme } from "@/components/theme-provider"
import { normalizeOpacity, getGradientCoords, getSolidStrokeColor, compressImage } from "@/lib/canvas-helpers"
import { isGradientStroke, getGradientId } from "@/lib/types"
import { ImageUploadDialog } from "./image-upload-dialog"
import type {
  AppState,
  CanvasElement,
  ToolType,
  Viewport,
  StrokeStyle,
  ArrowHeadType,
  PreviewState,
  SmartConnection,
  HandlePosition,
} from "@/lib/types"
import { useCanvasStore, useHasHydrated } from "@/lib/store"
import { autoHandlePositions } from "@/lib/connector-utils"
// </CHANGE> Import ActionsMenu component
import { ActionsMenu } from "./actions-menu"
// Import BrandIcon component
import { BrandIcon } from "@/components/brand-icon"

import { toast } from "sonner"
// Helper for ID generation
const generateId = () => Math.random().toString(36).substr(2, 9)
const CANVAS_DEBUG = process.env.NEXT_PUBLIC_CANVAS_DEBUG === "true"
const SmartConnectorLayer = dynamic(
  () => import("./smart-connector-layer").then((mod) => mod.SmartConnectorLayer),
  { ssr: false },
)

const canvasDebugLog = (...args: unknown[]) => {
  if (!CANVAS_DEBUG) return
  console.log(...args)
}

// Helper to convert textAlign to SVG textAnchor
const getTextAnchor = (textAlign: string | undefined): "start" | "middle" | "end" => {
  switch (textAlign) {
    case "center":
      return "middle"
    case "right":
      return "end"
    case "left":
    default:
      return "start"
  }
}

type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"
type LineHandle = "start" | "end"
type CanvasHistoryEntry = {
  elements: CanvasElement[]
  connections: SmartConnection[]
}

const arraysShareReferences = <T,>(a: readonly T[], b: readonly T[]) => {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

const createHistoryEntry = (elements: CanvasElement[], connections: SmartConnection[]): CanvasHistoryEntry => ({
  // Keep element/connection object references (structural sharing), only copy array shells.
  elements: [...elements],
  connections: [...connections],
})

const historyEntriesEqual = (a: CanvasHistoryEntry, b: CanvasHistoryEntry) =>
  arraysShareReferences(a.elements, b.elements) && arraysShareReferences(a.connections, b.connections)

// Helper to sanitize elements for Liveblocks storage (removes undefined)
const _sanitizeElement = (element: CanvasElement): CanvasElement => {
  const sanitized = { ...element }
  Object.keys(sanitized).forEach((key) => {
    if (sanitized[key as keyof CanvasElement] === undefined) {
      delete sanitized[key as keyof CanvasElement]
    }
  })
  return sanitized
}


const INITIAL_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

export function Canvas({ previewElements }: { previewElements?: PreviewState | null }) {
  const { resolvedTheme } = useTheme()
  const hasHydrated = useHasHydrated()

  const elements = useCanvasStore((state) => state.elements)
  const connections = useCanvasStore((state) => state.connections)
  const addElement = useCanvasStore((state) => state.addElement)
  const updateElements = useCanvasStore((state) => state.updateElements)
  const addConnection = useCanvasStore((state) => state.addConnection)
  const updateConnections = useCanvasStore((state) => state.updateConnections)
  const setCanvasState = useCanvasStore((state) => state.setCanvasState)

  const getInitialState = (): AppState => ({
    tool: "selection",
    isDragging: false,
    selection: [],
    currentItemId: null,
    currentItemStrokeColor: resolvedTheme === "dark" ? "#ffffff" : "#000000",
    currentItemBackgroundColor: "transparent",
    currentItemStrokeWidth: 2,
    currentItemStrokeStyle: "solid",
    currentItemRoughness: 1,
    currentItemOpacity: 100,
    currentItemTextAlign: "left",
    currentItemFontSize: 20, // Added default font size
    currentItemFontWeight: "normal", // Added default font weight
    currentItemArrowHeadStart: "none",
    currentItemArrowHeadEnd: "arrow",
    // Initialize gradient properties
    currentItemLinearGradient: undefined,
    currentItemRadialGradient: undefined,
  })

  const [appState, setAppState] = useState<AppState>(getInitialState())
  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT)
  const targetViewportRef = useRef({ x: 0, y: 0, zoom: 1 })
  const animationFrameRef = useRef<number | null>(null)
  const isAnimatingRef = useRef(false)

  // Smooth scroll settings - lower = smoother but slower
  const LERP_FACTOR = 0.24
  const _SCROLL_MULTIPLIER = 0.4 // Reduce scroll speed
  const ZOOM_LERP_FACTOR = 0.3

  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 })
  const [drawingElementId, setDrawingElementId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showImageDialog, setShowImageDialog] = useState(false)
  const [imageDialogPosition, setImageDialogPosition] = useState({ x: 0, y: 0 })
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle | null>(null)
  const [lineHandle, setLineHandle] = useState<LineHandle | null>(null)
  const [initialElementState, setInitialElementState] = useState<CanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null) // Ref for the canvas div

  const [connectorSource, setConnectorSource] = useState<{ elementId: string; handle: HandlePosition } | null>(null)
  const [connectorPreview, setConnectorPreview] = useState<{ x: number; y: number } | null>(null)
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const editingIdRef = useRef<string | null>(editingId)
  const viewportRef = useRef<Viewport>(viewport)
  const elementsRef = useRef<CanvasElement[]>(elements)
  const selectedConnectionIdRef = useRef<string | null>(selectedConnectionId)

  editingIdRef.current = editingId
  viewportRef.current = viewport
  elementsRef.current = elements
  selectedConnectionIdRef.current = selectedConnectionId

  const centerViewportOnElements = useCallback(() => {
    if (elements.length === 0) return

    // Calculate bounding box of all elements
    let minX = Number.POSITIVE_INFINITY,
      minY = Number.POSITIVE_INFINITY,
      maxX = Number.NEGATIVE_INFINITY,
      maxY = Number.NEGATIVE_INFINITY
    elements.forEach((el) => {
      minX = Math.min(minX, el.x)
      minY = Math.min(minY, el.y)
      maxX = Math.max(maxX, el.x + (el.width || 0))
      maxY = Math.max(maxY, el.y + (el.height || 0))
    })

    if (!isFinite(minX)) return

    const containerWidth = containerRef.current?.clientWidth || 800
    const containerHeight = containerRef.current?.clientHeight || 600

    // Calculate center of content
    const contentCenterX = (minX + maxX) / 2
    const contentCenterY = (minY + maxY) / 2

    // Set viewport so content is centered
    // viewport.x = containerCenter - contentCenter * zoom
    setViewport({
      x: containerWidth / 2 - contentCenterX,
      y: containerHeight / 2 - contentCenterY,
      zoom: 1,
    })
  }, [elements])

  const prevElementCountRef = useRef(0)
  useEffect(() => {
    if (prevElementCountRef.current === 0 && elements.length > 0) {
      // Elements were just added from empty state, center on them
      centerViewportOnElements()
    }
    prevElementCountRef.current = elements.length
  }, [elements.length, centerViewportOnElements])

  const _resetViewportToElements = useCallback(() => {
    if (elements.length === 0) return

    // Calculate bounding box of all elements
    let minX = Number.POSITIVE_INFINITY,
      minY = Number.POSITIVE_INFINITY,
      maxX = Number.NEGATIVE_INFINITY,
      maxY = Number.NEGATIVE_INFINITY
    elements.forEach((el) => {
      minX = Math.min(minX, el.x)
      minY = Math.min(minY, el.y)
      maxX = Math.max(maxX, el.x + el.width)
      maxY = Math.max(maxY, el.y + el.height)
    })

    const containerWidth = containerRef.current?.clientWidth || 800
    const containerHeight = containerRef.current?.clientHeight || 600

    // Center the elements in the viewport
    const contentWidth = maxX - minX
    const contentHeight = maxY - minY
    const centerX = minX + contentWidth / 2
    const centerY = minY + contentHeight / 2

    // Set viewport to center on content
    setViewport({
      x: containerWidth / 2 - centerX,
      y: containerHeight / 2 - centerY,
      zoom: 1,
    })

    canvasDebugLog("[v0] Reset viewport to center on elements:", { minX, minY, maxX, maxY, centerX, centerY })
  }, [elements])

  const appStateRef = useRef(appState)
  useEffect(() => {
    appStateRef.current = appState
  }, [appState])

  const historyRef = useRef<CanvasHistoryEntry[]>([])
  const historyIndexRef = useRef(-1)
  const isUndoRedoRef = useRef(false)
  const MAX_HISTORY = 50
  const historyInitializedRef = useRef(false)

  const saveToHistory = useCallback((currentElements: CanvasElement[], currentConnections: SmartConnection[]) => {
    const nextEntry = createHistoryEntry(currentElements, currentConnections)
    const currentEntry = historyRef.current[historyIndexRef.current]

    if (currentEntry && historyEntriesEqual(currentEntry, nextEntry)) {
      return
    }

    // Remove any future states if we're not at the end
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1)
    }

    historyRef.current.push(nextEntry)

    // Limit history size
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift()
    } else {
      historyIndexRef.current++
    }

    canvasDebugLog("[v0] History saved - index:", historyIndexRef.current, "total:", historyRef.current.length)
  }, [])

  const undo = useCallback(() => {
    canvasDebugLog("[v0] Undo called - index:", historyIndexRef.current, "history length:", historyRef.current.length)
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--
      isUndoRedoRef.current = true
      const previousState = historyRef.current[historyIndexRef.current]
      canvasDebugLog(
        "[v0] Undoing to state with",
        previousState.elements.length,
        "elements and",
        previousState.connections.length,
        "connections",
      )

      setCanvasState([...previousState.elements], [...previousState.connections])
      setAppState((prev) => ({ ...prev, selection: [] }))
    } else {
      canvasDebugLog("[v0] Cannot undo - at beginning of history")
    }
  }, [setCanvasState, setAppState])

  const redo = useCallback(() => {
    canvasDebugLog("[v0] Redo called - index:", historyIndexRef.current, "history length:", historyRef.current.length)
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++
      isUndoRedoRef.current = true
      const nextState = historyRef.current[historyIndexRef.current]
      canvasDebugLog(
        "[v0] Redoing to state with",
        nextState.elements.length,
        "elements and",
        nextState.connections.length,
        "connections",
      )

      setCanvasState([...nextState.elements], [...nextState.connections])
      setAppState((prev) => ({ ...prev, selection: [] }))
    } else {
      canvasDebugLog("[v0] Cannot redo - at end of history")
    }
  }, [setCanvasState, setAppState])

  useEffect(() => {
    if (!Array.isArray(elements) || !Array.isArray(connections)) return

    // Initialize history with first state (only once)
    if (!historyInitializedRef.current) {
      historyRef.current = [createHistoryEntry(elements, connections)]
      historyIndexRef.current = 0
      historyInitializedRef.current = true
      canvasDebugLog(
        "[v0] History initialized with",
        elements.length,
        "elements and",
        connections.length,
        "connections",
      )
      return
    }

    // Skip if this is an undo/redo operation
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false
      return
    }

    saveToHistory(elements, connections)
  }, [elements, connections, saveToHistory])

  const handleAction = useCallback(
    (action: string) => {
      canvasDebugLog("[v0] handleAction called with:", action, "selection:", appStateRef.current.selection)
      const currentSelection = appStateRef.current.selection

      if (action === "delete") {
        let didDeleteSomething = false
        if (selectedConnectionId) {
          updateConnections((prev) => prev.filter((conn) => conn.id !== selectedConnectionId))
          setSelectedConnectionId(null)
          didDeleteSomething = true
        }

        if (currentSelection.length === 0) {
          if (!didDeleteSomething) return
          setAppState((prev) => ({ ...prev, selection: [] }))
          return
        }

        const deletableElementIds = new Set(
          elements.filter((el) => currentSelection.includes(el.id) && !el.isLocked).map((el) => el.id),
        )
        if (deletableElementIds.size === 0) return
        didDeleteSomething = true

        canvasDebugLog("[v0] Deleting elements:", currentSelection)
        updateElements((prev) => {
          canvasDebugLog("[v0] Before filter - element count:", prev.length)
          canvasDebugLog(
            "[v0] First few elements:",
            prev.slice(0, 3).map((e) => ({ id: e.id, type: e.type, locked: e.isLocked })),
          )

            const filtered = prev.filter((el) => {
              const inSelection = currentSelection.includes(el.id)
              const shouldDelete = inSelection && !el.isLocked

            if (inSelection) {
              canvasDebugLog("[v0] Element", el.id, "in selection, locked:", el.isLocked, "will delete:", shouldDelete)
            }

            return !shouldDelete
          })

          canvasDebugLog("[v0] After filter - element count:", filtered.length)
          canvasDebugLog("[v0] Elements before delete:", prev.length, "after:", filtered.length)
          canvasDebugLog(
            "[v0] Filtered element IDs:",
            filtered.map((el) => el.id),
          )
          return filtered
        })
        updateConnections((prev) =>
          prev.filter((conn) => !deletableElementIds.has(conn.sourceId) && !deletableElementIds.has(conn.targetId)),
        )
        setSelectedConnectionId(null)
        setAppState((prev) => ({ ...prev, selection: [] }))
      } else if (action === "duplicate") {
        const newElements: CanvasElement[] = []
        const newSelection: string[] = []

        elements.forEach((el) => {
          if (appStateRef.current.selection.includes(el.id) && !el.isLocked) {
            const id = generateId()
            newElements.push({ ...el, id, x: el.x + 10, y: el.y + 10 })
            newSelection.push(id)
          }
        })
        newElements.forEach((el) => addElement(el))
        setAppState((prev) => ({ ...prev, selection: newSelection }))
      } else if (action === "bringToFront") {
        const selectedIds = new Set(appStateRef.current.selection)
        const selectedElements = elements.filter((el) => selectedIds.has(el.id))
        const otherElements = elements.filter((el) => !selectedIds.has(el.id))
        updateElements(() => [...otherElements, ...selectedElements])
      } else if (action === "sendToBack") {
        const selectedIds = new Set(appStateRef.current.selection)
        const selectedElements = elements.filter((el) => selectedIds.has(el.id))
        const otherElements = elements.filter((el) => !selectedIds.has(el.id))
        updateElements(() => [...selectedElements, ...otherElements])
      } else if (action === "group") {
        const groupId = generateId()
        updateElements((prev) =>
          prev.map((el) => {
            if (appStateRef.current.selection.includes(el.id)) {
              return { ...el, groupId }
            }
            return el
          }),
        )
      } else if (action === "ungroup") {
        updateElements((prev) =>
          prev.map((el) => {
            if (appStateRef.current.selection.includes(el.id)) {
              const { groupId: _groupId, ...rest } = el
              return rest
            }
            return el
          }),
        )
      } else if (action === "lock") {
        updateElements((prev) =>
          prev.map((el) => {
            if (appStateRef.current.selection.includes(el.id)) {
              return { ...el, isLocked: true }
            }
            return el
          }),
        )
      } else if (action === "unlock") {
        updateElements((prev) =>
          prev.map((el) => {
            if (appStateRef.current.selection.includes(el.id)) {
              return { ...el, isLocked: false }
            }
            return el
          }),
        )
      }
    },
    [updateElements, updateConnections, selectedConnectionId, elements, addElement],
  ) // Added proper dependencies for useCallback

  useEffect(() => {
    setAppState((prev) => ({
      ...prev,
      currentItemStrokeColor: resolvedTheme === "dark" ? "#ffffff" : "#000000",
    }))
  }, [resolvedTheme])

  useEffect(() => {
    if (editingId && textAreaRef.current) {
      textAreaRef.current.focus()
      textAreaRef.current.setSelectionRange(textAreaRef.current.value.length, textAreaRef.current.value.length)
    }
  }, [editingId])

  const actionHandlersRef = useRef({ handleAction, undo, redo })
  actionHandlersRef.current = { handleAction, undo, redo }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const currentElements = elementsRef.current
      if (!currentElements || !Array.isArray(currentElements)) {
        canvasDebugLog("[v0] Elements not ready yet, skipping keyboard event")
        return
      }

      canvasDebugLog("[v0] KeyDown event:", {
        key: e.key,
        editingId: editingIdRef.current,
        activeElement: document.activeElement?.tagName,
        selection: appStateRef.current.selection,
        target: e.target,
      })

      if (editingIdRef.current) return

      // Check if any input/textarea in the entire document has focus
      const isInputFocused =
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.getAttribute("contenteditable") === "true"

      if (isInputFocused) {
        canvasDebugLog("[v0] Input is focused, ignoring keyboard event")
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault()
        actionHandlersRef.current.undo()
        return
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault()
        actionHandlersRef.current.redo()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault()
        const allElementIds = currentElements.map((el) => el.id)
        setAppState((prev) => ({ ...prev, selection: allElementIds }))
        canvasDebugLog("[v0] Selected all elements:", allElementIds)
        return
      }

      if (e.key === "Backspace" || e.key === "Delete") {
        const selection = appStateRef.current.selection
        canvasDebugLog(
          "[v0] Delete key pressed, selection length:",
          selection.length,
          "selectedConnectionId:",
          selectedConnectionIdRef.current,
        )
        if (selection.length > 0 || selectedConnectionIdRef.current) {
          e.preventDefault()
          canvasDebugLog("[v0] Calling handleAction('delete')")
          actionHandlersRef.current.handleAction("delete")
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [setAppState])

  // --- Helpers ---

  const getMouseCoordinates = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const clientX = e.clientX - rect.left
    const clientY = e.clientY - rect.top
    // With transform: translate(x, y) scale(zoom), conversion is:
    // canvasX = (screenX / zoom) - viewportX
    return {
      x: clientX / viewport.zoom - viewport.x,
      y: clientY / viewport.zoom - viewport.y,
    }
  }

  const getCursorForHandle = (handle: ResizeHandle) => {
    switch (handle) {
      case "n":
      case "s":
        return "ns-resize"
      case "e":
      case "w":
        return "ew-resize"
      case "ne":
      case "sw":
        return "nesw-resize"
      case "nw":
      case "se":
        return "nwse-resize"
    }
  }

  const getClickedHandle = (element: CanvasElement, x: number, y: number): HandlePosition => {
    const centerX = element.x + element.width / 2
    const centerY = element.y + element.height / 2
    const dx = x - centerX
    const dy = y - centerY

    // Determine handle based on which quadrant the click is in, prioritizing horizontal/vertical if aligned
    const threshold = Math.min(element.width, element.height) * 0.3 // Adjust threshold as needed

    if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? "right" : "left"
    } else if (Math.abs(dy) > threshold) {
      return dy > 0 ? "bottom" : "top"
    } else {
      // If click is near the center and not clearly on a side, default to a common handle
      // This part might need more refined logic based on desired behavior
      return "right" // Default to right if not clearly on top/bottom/left
    }
  }

  const createElement = (id: string, x: number, y: number, type: ToolType): CanvasElement => {
    const element: CanvasElement = {
      id,
      type,
      x,
      y,
      width: 0,
      height: 0,
      strokeColor: appState.currentItemStrokeColor,
      backgroundColor: appState.currentItemBackgroundColor,
      strokeWidth: appState.currentItemStrokeWidth,
      strokeStyle: appState.currentItemStrokeStyle,
      roughness: appState.currentItemRoughness,
      opacity: normalizeOpacity(appState.currentItemOpacity ?? 100),
      angle: 0,
      seed: Math.random(),
      isLocked: false,
      textAlign: appState.currentItemTextAlign,
      // Add default label properties
      label: "",
      labelColor: resolvedTheme === "dark" ? "#ffffff" : "#000000",
      labelFontSize: 14,
      labelFontWeight: "normal",
      labelPadding: 8,
      // Initialize gradient properties for elements
      linearGradient: appState.currentItemLinearGradient,
      radialGradient: appState.currentItemRadialGradient,
    }

    if (type === "arrow" || type === "line") {
      element.points = [[0, 0]]
      if (type === "arrow") {
        element.arrowHeadStart = appState.currentItemArrowHeadStart
        element.arrowHeadEnd = appState.currentItemArrowHeadEnd
      }
    } else if (type === "freedraw") {
      element.points = []
    } else if (type === "text") {
      element.fontSize = appState.currentItemFontSize || 20 // Use current font size
      element.fontWeight = appState.currentItemFontWeight || "normal" // Use current font weight
      element.fontFamily = "sans-serif"
      element.text = ""
      element.backgroundColor = "transparent"
      element.strokeColor = resolvedTheme === "dark" ? "#ffffff" : "#000000"
    }

    return element
  }

  const createElementRef = useRef(createElement)
  const addElementRef = useRef(addElement)
  createElementRef.current = createElement
  addElementRef.current = addElement

  useEffect(() => {
    const handleGlobalPaste = async (e: ClipboardEvent) => {
      // If we are editing text, let the default paste behavior happen.
      if (
        editingIdRef.current ||
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.tagName === "INPUT"
      ) {
        return
      }

      const items = e.clipboardData?.items
      if (!items) return

      for (const item of items) {
        if (!item.type.includes("image")) continue

        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue

        try {
          const imageUrl = await compressImage(file)
          const id = generateId()

          // Calculate center of the viewport.
          const rect = containerRef.current?.getBoundingClientRect()
          const clientX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
          const clientY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2

          // Convert to canvas coordinates with latest viewport values.
          const currentViewport = viewportRef.current
          const x = (clientX - (rect?.left || 0)) / currentViewport.zoom - currentViewport.x
          const y = (clientY - (rect?.top || 0)) / currentViewport.zoom - currentViewport.y

          const newElement = createElementRef.current(id, x - 100, y - 100, "image")
          newElement.width = 200
          newElement.height = 200
          newElement.imageUrl = imageUrl
          addElementRef.current(newElement)
          setAppState((prev) => ({ ...prev, tool: "selection", selection: [id] }))
          toast.success("Image pasted successfully")
        } catch (error) {
          console.error("Error processing pasted image:", error)
          toast.error("Failed to paste image")
        }
      }
    }

    document.addEventListener("paste", handleGlobalPaste)
    return () => document.removeEventListener("paste", handleGlobalPaste)
  }, [setAppState])

  const isPointInElement = (x: number, y: number, el: CanvasElement): boolean => {
    const padding = 10

    if (el.type === "text") {
      // A more accurate text bounding box calculation would be ideal but complex.
      // For now, use the rough bounding box with padding.
      return (
        x >= el.x - padding && x <= el.x + el.width + padding && y >= el.y - padding && y <= el.y + el.height + padding
      )
    }

    // For shapes, consider their actual bounding box.
    const minX = Math.min(el.x, el.x + el.width)
    const maxX = Math.max(el.x, el.x + el.width)
    const minY = Math.min(el.y, el.y + el.height)
    const maxY = Math.max(el.y, el.y + el.height)

    return x >= minX - padding && x <= maxX + padding && y >= minY - padding && y <= maxY + padding
  }

  const isElementInSelectionBox = (
    el: CanvasElement,
    box: { startX: number; startY: number; endX: number; endY: number },
  ): boolean => {
    const minX = Math.min(box.startX, box.endX)
    const maxX = Math.max(box.startX, box.endX)
    const minY = Math.min(box.startY, box.endY)
    const maxY = Math.max(box.startY, box.endY)

    const elMinX = Math.min(el.x, el.x + el.width)
    const elMaxX = Math.max(el.x, el.x + el.width)
    const elMinY = Math.min(el.y, el.y + el.height)
    const elMaxY = Math.max(el.y, el.y + el.height)

    // Check if element overlaps with selection box
    return !(elMaxX < minX || elMinX > maxX || elMaxY < minY || elMinY > maxY)
  }

  const renderResizeHandles = (element: CanvasElement) => {
    const { x, y, width, height } = element
    const handleSize = 8 / viewport.zoom

    // Special handling for lines and arrows - show endpoint handles
    if ((element.type === "line" || element.type === "arrow") && element.points && element.points.length >= 2) {
      const startPoint = element.points[0]
      const endPoint = element.points[element.points.length - 1]
      
      const lineHandles: { handle: LineHandle; x: number; y: number }[] = [
        { handle: "start", x: x + startPoint[0] - handleSize / 2, y: y + startPoint[1] - handleSize / 2 },
        { handle: "end", x: x + endPoint[0] - handleSize / 2, y: y + endPoint[1] - handleSize / 2 },
      ]

      return (
        <>
          {lineHandles.map(({ handle, x: hx, y: hy }) => (
            <circle
              key={handle}
              cx={hx + handleSize / 2}
              cy={hy + handleSize / 2}
              r={handleSize / 2}
              fill="var(--background)"
              stroke="var(--primary)"
              strokeWidth={1 / viewport.zoom}
              className="pointer-events-auto"
              style={{ cursor: "move" }}
              onMouseDown={(e) => {
                e.stopPropagation()
                setLineHandle(handle)
                setInitialElementState(element)
                setLastMousePos({ x: e.clientX, y: e.clientY })
              }}
            />
          ))}
        </>
      )
    }

    // Standard resize handles for other shapes
    const handles: { handle: ResizeHandle; x: number; y: number }[] = [
      { handle: "nw", x: x - handleSize / 2, y: y - handleSize / 2 },
      { handle: "n", x: x + width / 2 - handleSize / 2, y: y - handleSize / 2 },
      { handle: "ne", x: x + width - handleSize / 2, y: y - handleSize / 2 },
      { handle: "w", x: x - handleSize / 2, y: y + height / 2 - handleSize / 2 },
      { handle: "e", x: x + width - handleSize / 2, y: y + height / 2 - handleSize / 2 },
      { handle: "sw", x: x - handleSize / 2, y: y + height - handleSize / 2 },
      { handle: "s", x: x + width / 2 - handleSize / 2, y: y + height - handleSize / 2 },
      { handle: "se", x: x + width - handleSize / 2, y: y + height - handleSize / 2 },
    ]

    return (
      <>
        {handles.map(({ handle, x: hx, y: hy }) => (
          <rect
            key={handle}
            x={hx}
            y={hy}
            width={handleSize}
            height={handleSize}
            fill="var(--background)"
            stroke="var(--primary)"
            strokeWidth={1 / viewport.zoom}
            className="pointer-events-auto"
            style={{ cursor: getCursorForHandle(handle) }}
            onMouseDown={(e) => {
              e.stopPropagation()
              setResizeHandle(handle)
              setInitialElementState(element)
              setLastMousePos({ x: e.clientX, y: e.clientY })
            }}
          />
        ))}
      </>
    )
  }

  // --- Handlers ---

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || appState.tool === "hand") {
      // setIsPanning(true) // Directly modify viewport for panning
      setViewport((prev) => ({ ...prev })) // Trigger re-render to update viewport state
      setLastMousePos({ x: e.clientX, y: e.clientY })
      return
    }

    if (editingId) {
      e.stopPropagation()
      return
    }

    const { x, y } = getMouseCoordinates(e)

    canvasDebugLog("[v0] Mouse click at canvas coords:", { x, y })
    canvasDebugLog("[v0] Current viewport:", viewport)
    canvasDebugLog("[v0] Current tool:", appState.tool)
    canvasDebugLog("[v0] Elements count:", elements.length)
    canvasDebugLog(
      "[v0] First 3 element positions:",
      elements.slice(0, 3).map((el) => ({
        id: el.id.slice(0, 8),
        type: el.type,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
      })),
    )

    if (appState.tool === "selection") {
      // Log element bounds for debugging
      const matchingElements = elements.filter((el) => {
        const padding = 10
        const minX = Math.min(el.x, el.x + el.width)
        const maxX = Math.max(el.x, el.x + el.width)
        const minY = Math.min(el.y, el.y + el.height)
        const maxY = Math.max(el.y, el.y + el.height)
        const isInBounds = x >= minX - padding && x <= maxX + padding && y >= minY - padding && y <= maxY + padding
        return isInBounds
      })
      canvasDebugLog(
        "[v0] Elements at click position:",
        matchingElements.length,
        matchingElements.map((el) => ({
          id: el.id,
          type: el.type,
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          isLocked: el.isLocked,
        })),
      )
    }

    if (appState.tool === "eraser") {
      const clickedElement = [...elements].reverse().find((el) => isPointInElement(x, y, el) && !el.isLocked)
      if (clickedElement) {
        const deletedElementId = clickedElement.id
        updateElements((prev) => prev.filter((el) => el.id !== clickedElement.id))
        updateConnections((prev) =>
          prev.filter((conn) => conn.sourceId !== deletedElementId && conn.targetId !== deletedElementId),
        )
        setSelectedConnectionId(null)
      }
      return
    }

    if (appState.tool === "image") {
      setImageDialogPosition({ x, y })
      setShowImageDialog(true)
      return
    }

    if (appState.tool === "selection") {
      const clickedElement = [...elements].reverse().find((el) => isPointInElement(x, y, el))

      if (clickedElement) {
        const groupIds = clickedElement.groupId
          ? elements.filter((el) => el.groupId === clickedElement.groupId).map((el) => el.id)
          : [clickedElement.id]

        if (e.shiftKey) {
          const isGroupSelected = groupIds.every((id) => appState.selection.includes(id))
          const newSelection = isGroupSelected
            ? appState.selection.filter((id) => !groupIds.includes(id))
            : [...new Set([...appState.selection, ...groupIds])]

          setAppState((prev) => ({
            ...prev,
            selection: newSelection,
            isDragging: !groupIds.every((id) => elements.find((el) => el.id === id)?.isLocked),
          }))
        } else {
          // Regular click - select group or single element
          const allSelectedLocked = groupIds.every((id) => elements.find((el) => el.id === id)?.isLocked)
          setAppState((prev) => ({
            ...prev,
            selection: groupIds,
            isDragging: !allSelectedLocked,
            currentItemStrokeColor: clickedElement.strokeColor,
            currentItemBackgroundColor: clickedElement.backgroundColor,
            currentItemStrokeWidth: clickedElement.strokeWidth,
            currentItemStrokeStyle: clickedElement.strokeStyle,
            currentItemRoughness: clickedElement.roughness,
            currentItemOpacity: clickedElement.opacity,
            currentItemTextAlign: clickedElement.textAlign || "left",
            currentItemFontSize: clickedElement.fontSize || 20, // Handle font size update
            currentItemFontWeight: clickedElement.fontWeight || "normal", // Handle font weight update
            currentItemArrowHeadStart: clickedElement.arrowHeadStart || "none",
            currentItemArrowHeadEnd: clickedElement.arrowHeadEnd || "arrow",
            // Update label properties for selected elements
            label: clickedElement.label || "",
            labelColor: clickedElement.labelColor || (resolvedTheme === "dark" ? "#ffffff" : "#000000"),
            labelFontSize: clickedElement.labelFontSize || 14,
            labelFontWeight: clickedElement.labelFontWeight || "normal",
            labelPadding: clickedElement.labelPadding ?? 8,
            // Update gradient properties for selected elements
            currentItemLinearGradient: clickedElement.linearGradient,
            currentItemRadialGradient: clickedElement.radialGradient,
          }))
        }
        setLastMousePos({ x: e.clientX, y: e.clientY })
      } else {
        if (!e.shiftKey) {
          setAppState((prev) => ({ ...prev, selection: [] }))
        }
        setAppState((prev) => ({
          ...prev,
          selectionBox: { startX: x, startY: y, endX: x, endY: y },
        }))
      }
      return
    }

    if (appState.tool === "text") {
      const id = generateId()
      const newElement = createElement(id, x, y, appState.tool)
      newElement.width = 120
      newElement.height = 40
      addElement(newElement)
      setEditingId(id)
      setAppState((prev) => ({ ...prev, tool: "selection", selection: [id] }))
      return
    }

    if (appState.tool === "freedraw") {
      const id = generateId()
      const newElement = createElement(id, x, y, appState.tool)
      // Don't add initial [0,0] point here - let mouseMove add points
      // This prevents a spurious line segment from origin after normalization
      addElement(newElement)
      setDrawingElementId(id)
      return
    }

    if (appState.tool === "connector") {
      // Find element under cursor
      const clickedElement = [...elements]
        .reverse()
        .find(
          (el) =>
            isPointInElement(x, y, el) && !el.isLocked && ["rectangle", "ellipse", "diamond", "text"].includes(el.type),
        )

      if (clickedElement) {
        // Determine which handle based on click position
        const handle = getClickedHandle(clickedElement, x, y)
        setConnectorSource({ elementId: clickedElement.id, handle })
        setConnectorPreview({ x, y })
      }
      return
    }

    if (["rectangle", "ellipse", "diamond", "line", "arrow", "image"].includes(appState.tool)) {
      const id = generateId()
      const newElement = createElement(id, x, y, appState.tool)
      addElement(newElement)
      setDrawingElementId(id)
    }
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = getMouseCoordinates(e)
    const clickedElement = [...elements].reverse().find((el) => isPointInElement(x, y, el) && !el.isLocked)

    if (clickedElement && clickedElement.type === "text") {
      setEditingId(clickedElement.id)
      // Ensure the element is selected (in case double click happened without selection somehow)
      setAppState((prev) => {
        if (prev.selection.includes(clickedElement.id)) return prev
        return { ...prev, selection: [clickedElement.id] }
      })
    }
  }

  const [touchStartPos, setTouchStartPos] = React.useState<{ x: number; y: number } | null>(null)
  const [lastTouchDistance, setLastTouchDistance] = React.useState<number | null>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      // Single touch - pan
      const touch = e.touches[0]
      setTouchStartPos({ x: touch.clientX, y: touch.clientY })
    } else if (e.touches.length === 2) {
      // Two finger pinch - zoom
      const touch1 = e.touches[0]
      const touch2 = e.touches[1]
      const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
      setLastTouchDistance(distance)
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && touchStartPos) {
      // Single touch - pan
      const touch = e.touches[0]
      const deltaX = touch.clientX - touchStartPos.x
      const deltaY = touch.clientY - touchStartPos.y

      setViewport((prev) => ({
        ...prev,
        x: prev.x + deltaX / prev.zoom,
        y: prev.y + deltaY / prev.zoom,
      }))

      setTouchStartPos({ x: touch.clientX, y: touch.clientY })
    } else if (e.touches.length === 2 && lastTouchDistance) {
      // Two finger pinch - zoom
      const touch1 = e.touches[0]
      const touch2 = e.touches[1]
      const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
      const delta = distance - lastTouchDistance

      const zoomSensitivity = 0.005
      const newZoom = Math.min(Math.max(viewport.zoom + delta * zoomSensitivity, 0.1), 5)

      setViewport((prev) => ({ ...prev, zoom: newZoom }))
      setLastTouchDistance(distance)
    }
  }

  const handleTouchEnd = () => {
    setTouchStartPos(null)
    setLastTouchDistance(null)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    // Direct panning update without setIsPanning state
    if (e.buttons === 4 || appState.tool === "hand") {
      // Middle mouse button or Hand tool
      const dx = e.clientX - lastMousePos.x
      const dy = e.clientY - lastMousePos.y
      setViewport((prev) => ({ ...prev, x: prev.x + dx / prev.zoom, y: prev.y + dy / prev.zoom }))
      setLastMousePos({ x: e.clientX, y: e.clientY })
      return
    }

    const { x, y } = getMouseCoordinates(e)

    if (resizeHandle && initialElementState) {
      const dx = (e.clientX - lastMousePos.x) / viewport.zoom
      const dy = (e.clientY - lastMousePos.y) / viewport.zoom

      updateElements((prev) =>
        prev.map((el) => {
          if (el.id !== initialElementState.id) return el

          let { x, y, width, height } = el

          if (resizeHandle.includes("e")) width += dx
          if (resizeHandle.includes("w")) {
            x += dx
            width -= dx
          }
          if (resizeHandle.includes("s")) height += dy
          if (resizeHandle.includes("n")) {
            y += dy
            height -= dy
          }

          // Clamp to a minimum size and handle potential flipping issues
          const MIN_SIZE = 1
          if (width < MIN_SIZE) {
            if (resizeHandle.includes("w")) {
              // If resizing from left, and width becomes < MIN_SIZE, adjust x to keep right edge in place
              x = el.x + el.width - MIN_SIZE
            }
            width = MIN_SIZE
          }
          if (height < MIN_SIZE) {
            if (resizeHandle.includes("n")) {
              // If resizing from top, and height becomes < MIN_SIZE, adjust y to keep bottom edge in place
              y = el.y + el.height - MIN_SIZE
            }
            height = MIN_SIZE
          }

          // Freedraw specific point scaling is complex with incremental updates and not handled here.
          // Resizing will only affect the bounding box for now.

          return { ...el, x, y, width, height }
        }),
      )

      setLastMousePos({ x: e.clientX, y: e.clientY })
      return
    }

    // Handle line/arrow endpoint dragging
    if (lineHandle && initialElementState) {
      const dx = (e.clientX - lastMousePos.x) / viewport.zoom
      const dy = (e.clientY - lastMousePos.y) / viewport.zoom

      updateElements((prev) =>
        prev.map((el) => {
          if (el.id !== initialElementState.id) return el
          if (!el.points || el.points.length < 2) return el

          const newPoints = [...el.points] as [number, number][]
          
          if (lineHandle === "start") {
            // Move start point - also need to adjust element position
            const newStartX = newPoints[0][0] + dx
            const newStartY = newPoints[0][1] + dy
            newPoints[0] = [newStartX, newStartY]
            
            // Normalize: move element origin to start point, adjust all points
            const offsetX = newPoints[0][0]
            const offsetY = newPoints[0][1]
            const normalizedPoints = newPoints.map(([px, py]) => [px - offsetX, py - offsetY] as [number, number])
            
            return { 
              ...el, 
              x: el.x + offsetX, 
              y: el.y + offsetY,
              points: normalizedPoints 
            }
          } else {
            // Move end point
            const lastIdx = newPoints.length - 1
            newPoints[lastIdx] = [newPoints[lastIdx][0] + dx, newPoints[lastIdx][1] + dy]
            return { ...el, points: newPoints }
          }
        }),
      )

      setLastMousePos({ x: e.clientX, y: e.clientY })
      return
    }

    if (appState.selectionBox) {
      setAppState((prev) => ({
        ...prev,
        selectionBox: prev.selectionBox ? { ...prev.selectionBox, endX: x, endY: y } : undefined,
      }))
      return
    }

    if (drawingElementId) {
      updateElements((prev) =>
        prev.map((el) => {
          if (el.id !== drawingElementId) return el

          if (el.type === "freedraw") {
            const newPoint: [number, number] = [x - el.x, y - el.y]
            return { ...el, points: [...(el.points || []), newPoint] }
          }

          if (el.type === "line" || el.type === "arrow") {
            const endPoint: [number, number] = [x - el.x, y - el.y]
            return { ...el, points: [[0, 0], endPoint] }
          }

          const width = x - el.x
          const height = y - el.y

          return { ...el, width, height }
        }),
      )
    } else if (appState.isDragging && appState.selection.length > 0) {
      const dx = (e.clientX - lastMousePos.x) / viewport.zoom
      const dy = (e.clientY - lastMousePos.y) / viewport.zoom

      updateElements((prev) =>
        prev.map((el) => {
          if (appState.selection.includes(el.id) && !el.isLocked) {
            return { ...el, x: el.x + dx, y: el.y + dy }
          }
          return el
        }),
      )
      setLastMousePos({ x: e.clientX, y: e.clientY })
    } else if (appState.tool === "connector" && connectorSource && connectorPreview) {
      setConnectorPreview({ x, y })
    }
  }

  const handleMouseUp = () => {
    // setIsPanning(false) // Panning handled directly in mousemove
    setResizeHandle(null)
    setLineHandle(null)
    setInitialElementState(null)

    if (appState.selectionBox) {
      const selectedIds = elements
        .filter((el) => isElementInSelectionBox(el, appState.selectionBox!))
        .map((el) => el.id)

      const expandedSelection = new Set<string>()
      selectedIds.forEach((id) => {
        const element = elements.find((el) => el.id === id)
        if (element?.groupId) {
          elements
            .filter((el) => el.groupId === element.groupId)
            .forEach((groupEl) => expandedSelection.add(groupEl.id))
        } else {
          expandedSelection.add(id)
        }
      })

      setAppState((prev) => ({
        ...prev,
        selection: Array.from(expandedSelection),
        selectionBox: undefined,
        isDragging: false,
      }))
      return
    }

    setAppState((prev) => ({ ...prev, isDragging: false }))

    if (drawingElementId) {
      updateElements((prev) =>
        prev.map((el) => {
          if (el.id !== drawingElementId) return el

          if (el.type === "freedraw" && el.points && el.points.length > 0) {
            const xs = el.points.map((p) => p[0])
            const ys = el.points.map((p) => p[1])
            const minX = Math.min(...xs)
            const maxX = Math.max(...xs)
            const minY = Math.min(...ys)
            const maxY = Math.max(...ys)

            // Normalize points relative to new top-left
            const normalizedPoints = el.points.map((p) => [p[0] - minX, p[1] - minY] as [number, number])

            return {
              ...el,
              x: el.x + minX,
              y: el.y + minY,
              width: maxX - minX,
              height: maxY - minY,
              points: normalizedPoints,
            }
          }

          let { x, y, width, height } = el

          if (el.type !== "arrow" && el.type !== "line") {
            if (width < 0) {
              x += width
              width = Math.abs(width)
            }
            if (height < 0) {
              y += height
              height = Math.abs(height)
            }
          }

          return { ...el, x, y, width, height }
        }),
      )
      setDrawingElementId(null)
      setAppState((prev) => ({ ...prev, tool: "selection", selection: [drawingElementId] }))
    }

    if (connectorSource && connectorPreview && appState.tool === "connector") {
      const { x, y } = connectorPreview
      // Find target element
      const targetElement = [...elements]
        .reverse()
        .find(
          (el) =>
            isPointInElement(x, y, el) &&
            !el.isLocked &&
            el.id !== connectorSource.elementId &&
            ["rectangle", "ellipse", "diamond", "text"].includes(el.type),
        )

      if (targetElement) {
        const sourceEl = elements.find((el) => el.id === connectorSource.elementId)
        if (sourceEl) {
          const handles = autoHandlePositions(sourceEl, targetElement)
          const newConnection: SmartConnection = {
            id: generateId(),
            sourceId: connectorSource.elementId,
            targetId: targetElement.id,
            sourceHandle: handles.sourceHandle,
            targetHandle: handles.targetHandle,
            strokeColor: appState.currentItemStrokeColor,
            strokeWidth: appState.currentItemStrokeWidth,
            strokeStyle: appState.currentItemStrokeStyle,
            arrowHeadEnd: "arrow",
            pathType: "smoothstep",
          }
          addConnection(newConnection)
        }
      }

      setConnectorSource(null)
      setConnectorPreview(null)
      return
    }
  }

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()

      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      // Check if zooming (Ctrl/Cmd + wheel)
      if (e.ctrlKey || e.metaKey) {
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        // Calculate zoom
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
        const newZoom = Math.min(Math.max(viewport.zoom * zoomFactor, 0.1), 5)

        // Zoom towards mouse position
        const zoomRatio = newZoom / viewport.zoom
        const newX = mouseX - (mouseX - viewport.x) * zoomRatio
        const newY = mouseY - (mouseY - viewport.y) * zoomRatio

        setViewport({
          x: newX,
          y: newY,
          zoom: newZoom,
        })
      } else {
        const SCROLL_SPEED = 0.6
        // which shows content on the right
        setViewport((prev) => ({
          ...prev,
          x: prev.x - (e.deltaX * SCROLL_SPEED) / prev.zoom,
          y: prev.y - (e.deltaY * SCROLL_SPEED) / prev.zoom,
        }))
      }
    },
    [viewport],
  )

  const handleAppStateChange = (updates: Partial<typeof appState>) => {
    // Update selected elements if any
    if (appState.selection.length > 0) {
      canvasDebugLog("[v0] Updating selected elements:", appState.selection)
      const updatedProps: Partial<CanvasElement> = {}
      if (updates.currentItemStrokeColor !== undefined) updatedProps.strokeColor = updates.currentItemStrokeColor
      if (updates.currentItemBackgroundColor !== undefined)
        updatedProps.backgroundColor = updates.currentItemBackgroundColor
      if (updates.currentItemStrokeWidth !== undefined) updatedProps.strokeWidth = updates.currentItemStrokeWidth
      if (updates.currentItemStrokeStyle !== undefined) updatedProps.strokeStyle = updates.currentItemStrokeStyle
      if (updates.currentItemRoughness !== undefined) updatedProps.roughness = updates.currentItemRoughness
      if (updates.currentItemOpacity !== undefined) updatedProps.opacity = normalizeOpacity(updates.currentItemOpacity)
      if (updates.currentItemTextAlign !== undefined) updatedProps.textAlign = updates.currentItemTextAlign
      if (updates.currentItemFontSize !== undefined) updatedProps.fontSize = updates.currentItemFontSize
      if (updates.currentItemFontWeight !== undefined) updatedProps.fontWeight = updates.currentItemFontWeight
      if (updates.currentItemArrowHeadStart !== undefined)
        updatedProps.arrowHeadStart = updates.currentItemArrowHeadStart
      if (updates.currentItemArrowHeadEnd !== undefined) updatedProps.arrowHeadEnd = updates.currentItemArrowHeadEnd
      // Add label property updates
      if (updates.label !== undefined) updatedProps.label = updates.label
      if (updates.labelColor !== undefined) updatedProps.labelColor = updates.labelColor
      if (updates.labelFontSize !== undefined) updatedProps.labelFontSize = updates.labelFontSize
      if (updates.labelFontWeight !== undefined) updatedProps.labelFontWeight = updates.labelFontWeight
      if (updates.labelPadding !== undefined) updatedProps.labelPadding = updates.labelPadding

      // Gradient updates
      if (updates.currentItemLinearGradient !== undefined)
        updatedProps.linearGradient = updates.currentItemLinearGradient
      if (updates.currentItemRadialGradient !== undefined)
        updatedProps.radialGradient = updates.currentItemRadialGradient

      if (Object.keys(updatedProps).length > 0) {
        canvasDebugLog("[v0] Applying updates to elements:", updatedProps)
        updateElements((els) => els.map((el) => (appState.selection.includes(el.id) ? { ...el, ...updatedProps } : el)))
      }
    } else if (selectedConnectionId) {
      canvasDebugLog("[v0] Updating selected connection:", selectedConnectionId)
      const updatedProps: Partial<SmartConnection> = {}
      if (updates.currentItemStrokeColor !== undefined) updatedProps.strokeColor = updates.currentItemStrokeColor
      if (updates.currentItemStrokeWidth !== undefined) updatedProps.strokeWidth = updates.currentItemStrokeWidth
      if (updates.currentItemStrokeStyle !== undefined) updatedProps.strokeStyle = updates.currentItemStrokeStyle
      if (updates.currentItemArrowHeadStart !== undefined) updatedProps.arrowHeadStart = updates.currentItemArrowHeadStart
      if (updates.currentItemArrowHeadEnd !== undefined) updatedProps.arrowHeadEnd = updates.currentItemArrowHeadEnd

      if (Object.keys(updatedProps).length > 0) {
        canvasDebugLog("[v0] Applying updates to connection:", updatedProps)
        updateConnections((conns) =>
          conns.map((conn) => (conn.id === selectedConnectionId ? { ...conn, ...updatedProps } : conn)),
        )
      }
    } else {
      canvasDebugLog("[v0] No selection - only updating appState for future elements")
    }

    setAppState((prev) => ({ ...prev, ...updates }))
  }

  const animateSmoothScroll = useCallback(() => {
    const currentX = viewport.x
    const currentY = viewport.y
    const currentZoom = viewport.zoom
    const targetX = targetViewportRef.current.x
    const targetY = targetViewportRef.current.y
    const targetZoom = targetViewportRef.current.zoom

    // Calculate the difference
    const diffX = targetX - currentX
    const diffY = targetY - currentY
    const diffZoom = targetZoom - currentZoom

    // Check if we're close enough to stop animating
    const threshold = 0.1
    const zoomThreshold = 0.001

    if (Math.abs(diffX) < threshold && Math.abs(diffY) < threshold && Math.abs(diffZoom) < zoomThreshold) {
      setViewport({ x: targetX, y: targetY, zoom: targetZoom })
      isAnimatingRef.current = false
      animationFrameRef.current = null
      return
    }

    // Lerp towards target
    const newX = currentX + diffX * LERP_FACTOR
    const newY = currentY + diffY * LERP_FACTOR
    const newZoom = currentZoom + diffZoom * ZOOM_LERP_FACTOR

    setViewport({ x: newX, y: newY, zoom: newZoom })

    // Continue animation
    animationFrameRef.current = requestAnimationFrame(animateSmoothScroll)
  }, [viewport])

  // Start smooth scroll animation if not already running
  const _startSmoothScroll = useCallback(() => {
    if (!isAnimatingRef.current) {
      isAnimatingRef.current = true
      animationFrameRef.current = requestAnimationFrame(animateSmoothScroll)
    }
  }, [animateSmoothScroll])

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  // Initialize target viewport ref when viewport changes externally
  useEffect(() => {
    if (!isAnimatingRef.current) {
      targetViewportRef.current = { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
    }
  }, [viewport.x, viewport.y, viewport.zoom])

  const renderArrowHead = (
    x: number,
    y: number,
    angle: number,
    type: ArrowHeadType | undefined,
    color: string,
    strokeWidth: number,
  ) => {
    if (!type || type === "none") return null

    const size = strokeWidth * 3

    if (type === "arrow") {
      const points = [
        [x, y],
        [x - size * 2, y - size],
        [x - size * 2, y + size],
      ]
        .map(([px, py]) => {
          const cos = Math.cos(angle)
          const sin = Math.sin(angle)
          const dx = px - x
          const dy = py - y
          return [x + dx * cos - dy * sin, y + dx * sin + dy * cos]
        })
        .map((p) => p.join(","))
        .join(" ")

      return <polygon points={points} fill={color} />
    }

    if (type === "dot") {
      return <circle cx={x} cy={y} r={size} fill={color} />
    }

    if (type === "bar") {
      const barLength = size * 2
      const cos = Math.cos(angle + Math.PI / 2)
      const sin = Math.sin(angle + Math.PI / 2)
      const x1 = x + cos * barLength
      const y1 = y + sin * barLength
      const x2 = x - cos * barLength
      const y2 = y - sin * barLength

      return (
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={strokeWidth * 1.5} strokeLinecap="round" />
      )
    }

    return null
  }

  const handleTextChange = (id: string, newText: string) => {
    updateElements((prev) =>
      prev.map((el) => {
        if (el.id === id) {
          return { ...el, text: newText }
        }
        return el
      }),
    )
  }

  const handleBlur = () => {
    setEditingId(null)
  }

  const getStrokeDashArray = (style: StrokeStyle, width: number) => {
    switch (style) {
      case "dashed":
        return `${width * 4} ${width * 2}`
      case "dotted":
        return `${width} ${width * 2}`
      default:
        return "none"
    }
  }

  const renderShapeLabel = (
    el: CanvasElement,
    dimensions: { x: number; y: number; width: number; height: number },
    typography: { fontSize: number; lineHeight: number },
  ) => {
    if (!el.label) return null

    return (
      <foreignObject x={dimensions.x} y={dimensions.y} width={dimensions.width} height={dimensions.height}>
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: el.labelColor || getSolidStrokeColor(el.strokeColor),
            fontSize: el.labelFontSize || typography.fontSize,
            fontWeight: el.labelFontWeight || "normal",
            textAlign: "center",
            overflow: "hidden",
            wordBreak: "break-word",
            lineHeight: typography.lineHeight,
          }}
        >
          {el.label}
        </div>
      </foreignObject>
    )
  }

  const renderCanvasElement = (el: CanvasElement, mode: "live" | "preview", options?: { isSelected?: boolean; isEditing?: boolean }) => {
    const isPreview = mode === "preview"
    const strokeDasharray = isPreview ? "4 4" : getStrokeDashArray(el.strokeStyle, el.strokeWidth)
    const fillValue = isGradientStroke(el.strokeColor) ? `url(#${getGradientId(el.id)})` : el.backgroundColor
    const strokeColorValue = getSolidStrokeColor(el.strokeColor)
    const elementOpacity = normalizeOpacity(el.opacity) * (isPreview ? 0.7 : 1)
    const isEditing = Boolean(options?.isEditing)

    return (
      <g
        key={isPreview ? `preview-${el.id}` : el.id}
        className={isPreview ? "pointer-events-none" : "pointer-events-auto"}
        shapeRendering={isPreview ? undefined : "geometricPrecision"}
        opacity={isPreview ? 0.5 : undefined}
      >
        {el.type === "rectangle" && (
          <g>
            <rect
              x={el.x}
              y={el.y}
              width={el.width}
              height={el.height}
              fill={fillValue}
              stroke={strokeColorValue}
              strokeWidth={el.strokeWidth}
              strokeDasharray={strokeDasharray}
              rx={isPreview ? (isNaN(el.roughness) ? 0 : (el.roughness || 0) * 5) : 4}
              ry={isPreview ? undefined : 4}
              opacity={elementOpacity}
            />
            {renderShapeLabel(
              el,
              {
                x: el.x + (el.labelPadding ?? 8),
                y: el.y + (el.labelPadding ?? 8),
                width: el.width - (el.labelPadding ?? 8) * 2,
                height: el.height - (el.labelPadding ?? 8) * 2,
              },
              { fontSize: 14, lineHeight: 1.2 },
            )}
          </g>
        )}

        {el.type === "ellipse" && (
          <g>
            <ellipse
              cx={el.x + el.width / 2}
              cy={el.y + el.height / 2}
              rx={Math.abs(el.width || 0) / 2}
              ry={Math.abs(el.height || 0) / 2}
              fill={fillValue}
              stroke={strokeColorValue}
              strokeWidth={el.strokeWidth}
              strokeDasharray={strokeDasharray}
              opacity={elementOpacity}
            />
            {renderShapeLabel(
              el,
              {
                x: el.x + (el.labelPadding ?? 12),
                y: el.y + (el.labelPadding ?? 12),
                width: el.width - (el.labelPadding ?? 12) * 2,
                height: el.height - (el.labelPadding ?? 12) * 2,
              },
              { fontSize: 14, lineHeight: 1.2 },
            )}
          </g>
        )}

        {el.type === "diamond" && (
          <g>
            <polygon
              points={`${el.x + el.width / 2},${el.y} ${el.x + el.width},${el.y + el.height / 2} ${el.x + el.width / 2},${el.y + el.height} ${el.x},${el.y + el.height / 2}`}
              fill={fillValue}
              stroke={strokeColorValue}
              strokeWidth={el.strokeWidth}
              strokeDasharray={strokeDasharray}
              opacity={elementOpacity}
              strokeLinejoin={isPreview ? undefined : "round"}
            />
            {renderShapeLabel(
              el,
              {
                x: el.x + el.width * 0.25,
                y: el.y + el.height * 0.25,
                width: el.width * 0.5,
                height: el.height * 0.5,
              },
              { fontSize: 12, lineHeight: 1.1 },
            )}
          </g>
        )}

        {el.type === "arrow" && el.points && el.points.length > 0 && (
          <g>
            {(() => {
              const startPoint = el.points[0]
              const endPoint = el.points[el.points.length - 1]
              const lineAngle = Math.atan2(endPoint[1] - startPoint[1], endPoint[0] - startPoint[0])

              return (
                <>
                  <line
                    x1={el.x + startPoint[0]}
                    y1={el.y + startPoint[1]}
                    x2={el.x + endPoint[0]}
                    y2={el.y + endPoint[1]}
                    stroke={strokeColorValue}
                    strokeWidth={el.strokeWidth || 2}
                    strokeDasharray={strokeDasharray}
                    opacity={elementOpacity}
                    strokeLinecap={isPreview ? undefined : "round"}
                  />
                  {renderArrowHead(
                    el.x + endPoint[0],
                    el.y + endPoint[1],
                    lineAngle,
                    el.arrowHeadEnd,
                    strokeColorValue,
                    el.strokeWidth,
                  )}
                  {renderArrowHead(
                    el.x + startPoint[0],
                    el.y + startPoint[1],
                    lineAngle + Math.PI,
                    el.arrowHeadStart,
                    strokeColorValue,
                    el.strokeWidth,
                  )}
                </>
              )
            })()}
          </g>
        )}

        {el.type === "line" && el.points && el.points.length > 0 && (
          <line
            x1={el.x + el.points[0][0]}
            y1={el.y + el.points[0][1]}
            x2={el.x + el.points[el.points.length - 1][0]}
            y2={el.y + el.points[el.points.length - 1][1]}
            stroke={strokeColorValue || (resolvedTheme === "dark" ? "#ffffff" : "#000000")}
            strokeWidth={el.strokeWidth || 2}
            strokeDasharray={strokeDasharray}
            opacity={elementOpacity}
            strokeLinecap={isPreview ? undefined : "round"}
          />
        )}

        {el.type === "freedraw" && el.points && el.points.length > 0 && (
          <g transform={`translate(${el.x}, ${el.y})`}>
            <polyline
              points={el.points.map((p) => `${p[0]},${p[1]}`).join(" ")}
              fill="none"
              stroke={strokeColorValue}
              strokeWidth={isPreview ? el.strokeWidth : (el.strokeWidth || 2)}
              strokeDasharray={strokeDasharray}
              opacity={elementOpacity}
              strokeLinecap={isPreview ? undefined : "round"}
              strokeLinejoin={isPreview ? undefined : "round"}
            />
          </g>
        )}

        {el.type === "text" && isPreview && (
          <text
            x={el.x}
            y={el.y}
            fill={getSolidStrokeColor(el.strokeColor)}
            fontSize={el.fontSize}
            fontWeight={el.fontWeight}
            fontFamily={el.fontFamily}
            textAnchor={getTextAnchor(el.textAlign)}
            opacity={elementOpacity}
          >
            {el.text}
          </text>
        )}

        {el.type === "text" && !isPreview && !isEditing && (
          <foreignObject x={el.x} y={el.y} width={el.width || 200} height={el.height || 40} style={{ overflow: "visible" }}>
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent:
                  el.textAlign === "center"
                    ? "center"
                    : el.textAlign === "right"
                      ? "flex-end"
                      : "flex-start",
                color: getSolidStrokeColor(el.strokeColor),
                fontSize: el.fontSize || 20,
                fontWeight: el.fontWeight || "normal",
                fontFamily: el.fontFamily || "sans-serif",
                opacity: elementOpacity,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                padding: "4px 8px",
                boxSizing: "border-box",
              }}
            >
              {el.text || "Double-click to edit"}
            </div>
          </foreignObject>
        )}

        {el.type === "text" && !isPreview && isEditing && (
          <foreignObject
            x={el.x}
            y={el.y}
            width={Math.max(el.width || 200, 200)}
            height={Math.max(el.height || 40, 40)}
            style={{ overflow: "visible" }}
          >
            <textarea
              ref={textAreaRef}
              value={el.text}
              onChange={(e) => handleTextChange(el.id, e.target.value)}
              onBlur={handleBlur}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  handleBlur()
                }
                e.stopPropagation()
              }}
              style={{
                width: "100%",
                height: "100%",
                minWidth: "200px",
                minHeight: "40px",
                background: "transparent",
                border: "1px solid hsl(var(--primary))",
                borderRadius: "4px",
                outline: "none",
                resize: "both",
                color: getSolidStrokeColor(el.strokeColor),
                fontSize: el.fontSize || 20,
                fontWeight: el.fontWeight || "normal",
                fontFamily: el.fontFamily || "sans-serif",
                textAlign: el.textAlign || "left",
                padding: "4px 8px",
                boxSizing: "border-box",
              }}
              autoFocus
            />
          </foreignObject>
        )}

        {el.type === "image" && el.imageUrl && (
          <image
            href={el.imageUrl}
            x={el.x}
            y={el.y}
            width={el.width}
            height={el.height}
            preserveAspectRatio="xMidYMid meet"
            opacity={elementOpacity}
          />
        )}

        {!isPreview && options?.isSelected && !el.isLocked && renderResizeHandles(el)}
      </g>
    )
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          try {
            const imageUrl = await compressImage(file)
            const id = generateId()
            // Center the pasted image in the current viewport
            const centerX = viewport.x + (containerRef.current?.clientWidth || 800) / 2 / viewport.zoom
            const centerY = viewport.y + (containerRef.current?.clientHeight || 600) / 2 / viewport.zoom

            const newElement = createElement(
              id,
              -centerX + (containerRef.current?.clientWidth || 0),
              -centerY + (containerRef.current?.clientHeight || 0),
              "image",
            ) // Approximate center logic correction below

            // Actually, let's just put it in the center of the screen based on viewport
            const screenCenter = getMouseCoordinates({
              clientX:
                (containerRef.current?.getBoundingClientRect().left || 0) +
                (containerRef.current?.clientWidth || 800) / 2,
              clientY:
                (containerRef.current?.getBoundingClientRect().top || 0) +
                (containerRef.current?.clientHeight || 600) / 2,
            } as React.MouseEvent)

            newElement.x = screenCenter.x - 100
            newElement.y = screenCenter.y - 100
            newElement.width = 200
            newElement.height = 200
            newElement.imageUrl = imageUrl
            addElement(newElement)
            setAppState((prev) => ({ ...prev, tool: "selection", selection: [id] }))
            toast.success("Image pasted successfully")
          } catch (error) {
            console.error("Error processing pasted image:", error)
            toast.error("Failed to paste image")
          }
        }
      }
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer.files
    if (files.length > 0 && files[0].type.startsWith("image/")) {
      try {
        const { x, y } = getMouseCoordinates(e as unknown as React.MouseEvent)
        const imageUrl = await compressImage(files[0])
        const id = generateId()
        const newElement = createElement(id, x - 100, y - 100, "image")
        newElement.width = 200
        newElement.height = 200
        newElement.imageUrl = imageUrl
        addElement(newElement)
        setAppState((prev) => ({ ...prev, tool: "selection", selection: [id] }))
        toast.success("Image dropped successfully")
      } catch (error) {
        console.error("Error processing dropped image:", error)
        toast.error("Failed to process dropped image")
      }
    }
  }

  const handleImageSelect = (imageUrl: string) => {
    try {
      const id = generateId()
      // Use the stored position or default to center if something is wrong
      const x = imageDialogPosition?.x ?? 0
      const y = imageDialogPosition?.y ?? 0

      const newElement = createElement(id, x, y, "image")
      newElement.width = 200
      newElement.height = 200
      newElement.imageUrl = imageUrl
      addElement(newElement)
      setAppState((prev) => ({ ...prev, tool: "selection", selection: [id] }))
      setShowImageDialog(false)
      toast.success("Image added successfully")
    } catch (error) {
      console.error("Error adding image:", error)
      toast.error("Failed to add image")
      setShowImageDialog(false) // Ensure dialog closes even on error
    }
  }

  const handleConnectionClick = (connectionId: string | null) => {
    setSelectedConnectionId(connectionId)
    setAppState((prev) => ({ ...prev, selection: [] }))
  }

  if (!hasHydrated) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading canvas...</div>
      </div>
    )
  }

  // Render
  return (
    <div className="relative w-full h-full flex flex-col bg-background">
      {/* Fixed header bar */}
      <div className="flex-shrink-0 relative z-50">
        <div className="absolute top-4 left-4 z-50 md:z-50">
          <BrandIcon />
        </div>

        <Toolbar
          activeTool={appState.tool}
          onToolChange={(tool) => {
            setAppState((prev) => ({ ...prev, tool, selection: [] }))
            setDrawingElementId(null)
            // Clear connector state when switching tools
            setConnectorSource(null)
            setConnectorPreview(null)
            setSelectedConnectionId(null)
          }}
          undo={undo}
          redo={redo}
        />

        <div className="absolute bottom-4 left-4 z-50 md:bottom-auto md:top-4 md:left-auto md:right-4 flex items-center gap-2">
          <a
            href="https://github.com/WebRenew/drawit"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex items-center justify-center w-9 h-9 rounded-md bg-card border border-border/50 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="View on GitHub"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          </a>
          <DiagramPicker />
          <ThemeToggle />
          <LoginButton />
        </div>
      </div>

      {/* Main content area with fixed sidebar and scrollable canvas */}
      <div className="flex-1 relative overflow-hidden">
        {/* Fixed properties panel */}
        <PropertiesPanel
          appState={appState}
          selectedElements={elements.filter((el) => appState.selection.includes(el.id))}
          selectedConnectionId={selectedConnectionId} // Pass selected connection ID
          connections={connections} // Pass connections
          onChange={(updates) => handleAppStateChange(updates)}
          onAction={handleAction}
        />

        <ActionsMenu
          selectedElements={elements.filter((el) => appState.selection.includes(el.id))}
          onAction={handleAction}
        />

        {/* Scrollable canvas container */}
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-auto touch-pan-x touch-pan-y scrollbar-hide"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onWheel={handleWheel}
          onPaste={handlePaste} // Added paste handler
          onDragOver={handleDragOver} // Added drag over handler
          onDrop={handleDrop} // Added drop handler
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          {/* Background Grid - Moved outside transformed container to support infinite scrolling */}
          <div className="absolute inset-0 pointer-events-none">
            <svg className="w-full h-full">
              <defs>
                <pattern
                  id="grid"
                  width="20"
                  height="20"
                  patternUnits="userSpaceOnUse"
                  // Fixed transform order for grid pattern
                  patternTransform={`translate(${viewport.x * viewport.zoom} ${viewport.y * viewport.zoom}) scale(${viewport.zoom})`}
                >
                  <circle cx="1" cy="1" r="1" fill="var(--border)" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
          </div>

          <div
            ref={canvasRef} // Assign ref to the canvas div
            className="absolute inset-0 touch-none"
            // Removed event handlers from inner div to prevent blocking
            style={{
              // This is more intuitive: viewport.x/y are in canvas units
              transform: `translate(${viewport.x * viewport.zoom}px, ${viewport.y * viewport.zoom}px) scale(${viewport.zoom})`,
              transformOrigin: "0 0",
              width: "100%",
              height: "100%",
              zIndex: 1,
            }}
          >
            <svg className="w-full h-full overflow-visible pointer-events-none">
              {/* Removed background pattern from here */}


              {
                connectorSource && connectorPreview && (
                  <line
                    x1={(() => {
                      const el = elements.find((e) => e.id === connectorSource.elementId)
                      if (!el) return 0
                      const cx = el.x + el.width / 2
                      switch (connectorSource.handle) {
                        case "left":
                          return el.x
                        case "right":
                          return el.x + el.width
                        default:
                          return cx
                      }
                    })()}
                    y1={(() => {
                      const el = elements.find((e) => e.id === connectorSource.elementId)
                      if (!el) return 0
                      const cy = el.y + el.height / 2
                      switch (connectorSource.handle) {
                        case "top":
                          return el.y
                        case "bottom":
                          return el.y + el.height
                        default:
                          return cy
                      }
                    })()}
                    x2={connectorPreview.x}
                    y2={connectorPreview.y}
                    stroke={getSolidStrokeColor(appState.currentItemStrokeColor)}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    opacity={0.6}
                  />
                )
              }

                            {elements.map((el) =>
                renderCanvasElement(el, "live", {
                  isSelected: appState.selection.includes(el.id),
                  isEditing: editingId === el.id,
                }),
              )}

              {/* Gradient definitions */}
              {
                elements.map((el) => {
                  if (isGradientStroke(el.strokeColor)) {
                    const gradient = el.strokeColor
                    const gradientId = getGradientId(el.id)
                    const coords = getGradientCoords(gradient.angle)
                    return (
                      <defs key={gradientId}>
                        <linearGradient id={gradientId} x1={coords.x1} y1={coords.y1} x2={coords.x2} y2={coords.y2}>
                          <stop offset="0%" stopColor={gradient.colors[0]} />
                          <stop offset="100%" stopColor={gradient.colors[1]} />
                        </linearGradient>
                      </defs>
                    )
                  }
                  return null
                })
              }

                            {previewElements?.elements.map((el) => renderCanvasElement(el, "preview"))}
            </svg>
          </div>

          {connections.length > 0 && (
            <SmartConnectorLayer
              elements={elements}
              connections={connections}
              viewport={viewport}
              selectedConnectionId={selectedConnectionId}
              isDarkMode={resolvedTheme === "dark"}
              onConnectionSelect={handleConnectionClick}
            />
          )}
        </div>
      </div>

      {showImageDialog && (
        <ImageUploadDialog
          position={imageDialogPosition}
          onSelect={handleImageSelect}
          onClose={() => setShowImageDialog(false)}
        />
      )}
    </div>
  )
}
