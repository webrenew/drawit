import type { CanvasElement, ToolType, StrokeStyle } from "@/lib/types"
import { getForegroundColor } from "./canvas-helpers"

/**
 * Create a line element between two points
 */
export function createLineElement(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeColor?: string,
  strokeWidth = 2,
  options: { startArrow?: boolean; endArrow?: boolean } = {},
  resolvedTheme?: string,
): Omit<CanvasElement, "id"> {
  const color = strokeColor || getForegroundColor(resolvedTheme)
  return {
    type: "line" as ToolType,
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1) || 1,
    height: Math.abs(y2 - y1) || 1,
    strokeColor: color,
    strokeWidth,
    strokeStyle: "solid" as StrokeStyle,
    backgroundColor: "transparent",
    opacity: 1,
    roughness: 1.6,
    angle: 0,
    seed: Math.floor(Math.random() * 2147483647),
    isLocked: false,
    groupId: undefined,
    arrowHeadStart: options.startArrow ? "arrow" : "none",
    arrowHeadEnd: options.endArrow ? "arrow" : "none",
    points: [
      [x1 < x2 ? 0 : Math.abs(x2 - x1), y1 < y2 ? 0 : Math.abs(y2 - y1)],
      [x1 < x2 ? Math.abs(x2 - x1) : 0, y1 < y2 ? Math.abs(y2 - y1) : 0],
    ],
  }
}

/**
 * Create a text element
 */
export function createTextElement(
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  options: {
    strokeColor?: string
    backgroundColor?: string
    textAlign?: "left" | "center" | "right"
    fontSize?: "small" | "medium" | "large" | number
    fontWeight?: "normal" | "bold" | string
    opacity?: number
  } = {},
): Omit<CanvasElement, "id"> {
  const fontSizeMap = { small: 12, medium: 16, large: 20 }
  const fontSize = typeof options.fontSize === "string" 
    ? fontSizeMap[options.fontSize] || 16 
    : options.fontSize ?? 16
  
  return {
    type: "text" as ToolType,
    x,
    y,
    width,
    height,
    strokeColor: options.strokeColor || "#000000",
    strokeWidth: 2,
    strokeStyle: "solid" as StrokeStyle,
    backgroundColor: options.backgroundColor || "transparent",
    opacity: options.opacity ?? 1,
    roughness: 0,
    angle: 0,
    seed: Math.floor(Math.random() * 2147483647),
    isLocked: false,
    groupId: undefined,
    text,
    textAlign: options.textAlign || "left",
    fontSize,
    fontWeight: options.fontWeight === "bold" ? "700" : "400",
  }
}

/**
 * Create a shape element (rectangle, ellipse, diamond, etc.)
 */
export function createShapeElement(
  type: ToolType | string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    strokeColor?: string
    backgroundColor?: string
    opacity?: number
    strokeWidth?: number
    strokeStyle?: StrokeStyle
    roughness?: number
  } = {},
): Omit<CanvasElement, "id"> {
  return {
    type: type as ToolType,
    x,
    y,
    width,
    height,
    strokeColor: options.strokeColor || "#000000",
    backgroundColor: options.backgroundColor || "transparent",
    opacity: options.opacity ?? 1,
    strokeWidth: options.strokeWidth ?? 2,
    strokeStyle: options.strokeStyle ?? "solid",
    roughness: options.roughness ?? 1.6,
    angle: 0,
    seed: Math.floor(Math.random() * 2147483647),
    isLocked: false,
    groupId: undefined,
  }
}

/**
 * Create an arrow element
 */
export function createArrowElement(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  options: {
    strokeColor?: string
    startArrow?: boolean
    endArrow?: boolean
  } = {},
): Omit<CanvasElement, "id"> {
  // Calculate base position and relative points
  const baseX = Math.min(fromX, toX)
  const baseY = Math.min(fromY, toY)

  return {
    type: "arrow" as ToolType,
    x: baseX,
    y: baseY,
    width: Math.abs(toX - fromX) || 1,
    height: Math.abs(toY - fromY) || 1,
    strokeColor: options.strokeColor || "#000000",
    strokeWidth: 2,
    strokeStyle: "solid" as StrokeStyle,
    backgroundColor: "transparent",
    opacity: 1,
    roughness: 1.6,
    angle: 0,
    seed: Math.floor(Math.random() * 2147483647),
    isLocked: false,
    groupId: undefined,
    arrowHeadStart: options.startArrow ? "arrow" : "none",
    arrowHeadEnd: options.endArrow ?? true ? "arrow" : "none",
    // Points are required for arrow/line rendering - relative to (x, y)
    points: [
      [fromX - baseX, fromY - baseY],
      [toX - baseX, toY - baseY],
    ],
  }
}
