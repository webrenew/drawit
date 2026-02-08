"use client"

import { Icons } from "./icons"
import { cn } from "@/lib/utils"
import { FONT_SIZES } from "@/lib/constants"
import type { AppState, StrokeStyle, ArrowHeadType, CanvasElement, TextAlign, SmartConnection } from "@/lib/types"
import { useTheme } from "@/components/theme-provider"
import { useIsMobile } from "@/hooks/use-mobile"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Settings } from "lucide-react"
import { ColorPicker } from "./color-picker"

interface PropertiesPanelProps {
  appState: AppState
  onChange: (updates: Partial<AppState>) => void
  onAction?: (
    action: "delete" | "duplicate" | "sendToBack" | "bringToFront" | "group" | "ungroup" | "lock" | "unlock",
  ) => void
  selectedElements?: CanvasElement[]
  selectedConnectionId?: string | null
  connections?: SmartConnection[]
}

export function PropertiesPanel({
  appState,
  onChange,
  onAction,
  selectedElements = [],
  selectedConnectionId,
  connections = [],
}: PropertiesPanelProps) {
  const isMobile = useIsMobile()
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== "light"

  const selectedConnection = selectedConnectionId ? connections.find((c) => c.id === selectedConnectionId) : null

  const hasConnectionSelected = !!selectedConnection
  const hasElementsSelected = selectedElements.length > 0

  console.log(
    "[v0] PropertiesPanel rendered - selection:",
    appState.selection,
    "selectedElements:",
    selectedElements.length,
    "selectedConnectionId:",
    selectedConnectionId,
  )

  const isArrowOrLine =
    selectedElements.length > 0 && (selectedElements[0].type === "arrow" || selectedElements[0].type === "line")
  const hasArrowSelected = selectedElements.length > 0 && selectedElements[0].type === "arrow"

  const allTextElements = selectedElements.length > 0 && selectedElements.every((el) => el.type === "text")

  const handleChange = (updates: Partial<AppState>) => {
    console.log("[v0] PropertiesPanel handleChange called with:", updates)
    onChange(updates)
  }

  const renderContent = () => (
    <div className="flex flex-col gap-6">
      {hasConnectionSelected && (
        <div className="text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded">Connector selected</div>
      )}

      <ColorPicker
        value={
          hasConnectionSelected
            ? selectedConnection?.strokeColor || appState.currentItemStrokeColor
            : appState.currentItemStrokeColor
        }
        onChange={(color) => handleChange({ currentItemStrokeColor: color })}
        type="stroke"
        isDark={isDark}
        label={hasConnectionSelected ? "Line Color" : allTextElements ? "Text Color" : "Stroke"}
      />

      {/* Text Alignment Controls - only show for text elements, not connectors */}
      {allTextElements && !hasConnectionSelected && (
        <>
          <div className="space-y-3">
            <label className="text-xs font-medium text-muted-foreground">Text size</label>
            <div className="flex gap-2 bg-secondary/30 p-1 rounded-md">
              {FONT_SIZES.map((size) => (
                <button
                  key={size.value}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleChange({ currentItemFontSize: size.value })
                  }}
                  className={cn(
                    "flex-1 h-8 flex items-center justify-center rounded hover:bg-card transition-colors text-xs font-medium cursor-pointer",
                    appState.currentItemFontSize === size.value
                      ? "bg-card shadow-sm text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  {size.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-medium text-muted-foreground">Text style</label>
            <div className="flex gap-2 bg-secondary/30 p-1 rounded-md">
              {[
                { value: "left", icon: <Icons.AlignLeft className="w-4 h-4" /> },
                { value: "center", icon: <Icons.AlignCenter className="w-4 h-4" /> },
                { value: "right", icon: <Icons.AlignRight className="w-4 h-4" /> },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleChange({ currentItemTextAlign: opt.value as TextAlign })
                  }}
                  className={cn(
                    "flex-1 h-8 flex items-center justify-center rounded hover:bg-card transition-colors cursor-pointer",
                    appState.currentItemTextAlign === opt.value
                      ? "bg-card shadow-sm text-primary"
                      : "text-muted-foreground",
                  )}
                  title={`Align ${opt.value}`}
                >
                  {opt.icon}
                </button>
              ))}
              <div className="w-px bg-border mx-1" />
              {[
                { value: "normal", icon: <span className="text-sm font-normal">Aa</span> },
                { value: "bold", icon: <span className="text-sm font-bold">Aa</span> },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleChange({ currentItemFontWeight: opt.value as "normal" | "bold" })
                  }}
                  className={cn(
                    "flex-1 h-8 flex items-center justify-center rounded hover:bg-card transition-colors cursor-pointer",
                    appState.currentItemFontWeight === opt.value ? "bg-card shadow-sm" : "text-muted-foreground",
                  )}
                  title={`Font weight: ${opt.value}`}
                >
                  {opt.icon}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {!hasConnectionSelected && !isArrowOrLine && (
        <ColorPicker
          value={appState.currentItemBackgroundColor}
          onChange={(color) => handleChange({ currentItemBackgroundColor: typeof color === "string" ? color : color.colors[0] })}
          type="background"
          isDark={isDark}
          label="Background"
        />
      )}

      {/* Stroke Width */}
      <div className="space-y-3">
        <label className="text-xs font-medium text-muted-foreground">
          {hasConnectionSelected ? "Line width" : "Stroke width"}
        </label>
        <div className="flex gap-2 bg-secondary/30 p-1 rounded-md">
          {[
            { value: 2, height: "h-[2px]" },
            { value: 4, height: "h-[4px]" },
            { value: 6, height: "h-[6px]" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleChange({ currentItemStrokeWidth: opt.value })
              }}
              className={cn(
                "flex-1 h-10 flex items-center justify-center rounded hover:bg-card transition-colors cursor-pointer",
                appState.currentItemStrokeWidth === opt.value ? "bg-card shadow-sm" : "",
                hasConnectionSelected && selectedConnection?.strokeWidth === opt.value ? "bg-card shadow-sm" : "",
              )}
            >
              <div className={cn("w-8 rounded-full bg-current", opt.height)} />
            </button>
          ))}
        </div>
      </div>

      {/* Stroke Style */}
      <div className="space-y-3">
        <label className="text-xs font-medium text-muted-foreground">
          {hasConnectionSelected ? "Line style" : "Stroke style"}
        </label>
        <div className="flex gap-2 bg-secondary/30 p-1 rounded-md">
          {[
            { value: "solid", icon: <div className="w-8 h-[2px] bg-current" /> },
            { value: "dashed", icon: <div className="w-8 h-[2px] border-t-2 border-dashed border-current" /> },
            { value: "dotted", icon: <div className="w-8 h-[2px] border-t-2 border-dotted border-current" /> },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleChange({ currentItemStrokeStyle: opt.value as StrokeStyle })
              }}
              className={cn(
                "flex-1 h-10 flex items-center justify-center rounded hover:bg-card transition-colors cursor-pointer",
                appState.currentItemStrokeStyle === opt.value ? "bg-card shadow-sm" : "",
                hasConnectionSelected && selectedConnection?.strokeStyle === opt.value ? "bg-card shadow-sm" : "",
              )}
            >
              {opt.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Arrow Head Style - only for arrows and connectors */}
      {(hasArrowSelected || hasConnectionSelected) && (
        <div className="space-y-3">
          <label className="text-xs font-medium text-muted-foreground">Arrow head</label>
          <div className="flex gap-2 bg-secondary/30 p-1 rounded-md">
            {[
              { value: "none", label: "—" },
              { value: "arrow", label: "→" },
              { value: "dot", label: "●" },
              { value: "bar", label: "|" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleChange({ currentItemArrowHeadEnd: opt.value as ArrowHeadType })
                }}
                className={cn(
                  "flex-1 h-10 flex items-center justify-center rounded hover:bg-card transition-colors text-lg cursor-pointer",
                  appState.currentItemArrowHeadEnd === opt.value ? "bg-card shadow-sm" : "",
                  hasConnectionSelected && selectedConnection?.arrowHeadEnd === opt.value ? "bg-card shadow-sm" : "",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Opacity - hide for connectors */}
      {!hasConnectionSelected && (
        <div className="space-y-3">
          <label className="text-xs font-medium text-muted-foreground">Opacity</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="100"
              value={appState.currentItemOpacity}
              onChange={(e) => handleChange({ currentItemOpacity: Number(e.target.value) })}
              onMouseDown={(e) => e.stopPropagation()}
              className="flex-1 h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <span className="text-xs text-muted-foreground w-10 text-right">{appState.currentItemOpacity}%</span>
          </div>
        </div>
      )}

      {/* Actions - when elements are selected */}
      {(hasElementsSelected || hasConnectionSelected) && onAction && (
        <div className="space-y-3 pt-4 border-t border-border">
          <label className="text-xs font-medium text-muted-foreground">Actions</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onAction("delete")
              }}
              className="flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-destructive/10 hover:bg-destructive/20 text-destructive text-xs font-medium transition-colors cursor-pointer"
            >
              <Icons.Trash className="w-4 h-4" />
              Delete
            </button>
            {hasElementsSelected && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onAction("duplicate")
                  }}
                  className="flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-secondary hover:bg-secondary/80 text-xs font-medium transition-colors cursor-pointer"
                >
                  <Icons.Copy className="w-4 h-4" />
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onAction("sendToBack")
                  }}
                  className="flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-secondary hover:bg-secondary/80 text-xs font-medium transition-colors cursor-pointer"
                >
                  Send Back
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onAction("bringToFront")
                  }}
                  className="flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-secondary hover:bg-secondary/80 text-xs font-medium transition-colors cursor-pointer"
                >
                  Bring Front
                </button>
                {selectedElements.some((el) => el.isLocked) ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      console.log("[v0] Unlock clicked")
                      onAction("unlock")
                    }}
                    className="flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-secondary hover:bg-secondary/80 text-xs font-medium transition-colors col-span-2 cursor-pointer"
                  >
                    <Icons.Unlock className="w-4 h-4" />
                    Unlock
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      console.log("[v0] Lock clicked")
                      onAction("lock")
                    }}
                    className="flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-secondary hover:bg-secondary/80 text-xs font-medium transition-colors col-span-2 cursor-pointer"
                  >
                    <Icons.Lock className="w-4 h-4" />
                    Lock
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <Sheet>
        <SheetTrigger asChild>
          <button
            type="button"
            className="fixed bottom-20 right-4 z-50 p-3 rounded-full bg-card shadow-lg border border-border"
          >
            <Settings className="w-5 h-5" />
          </button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="h-[70vh] rounded-t-xl pb-safe"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-4 pb-24 overflow-y-auto max-h-[calc(70vh-2rem)]">{renderContent()}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className="absolute left-4 top-1/2 -translate-y-1/2 w-56 bg-card rounded-xl shadow-lg border border-border p-4 overflow-y-auto max-h-[80vh] z-40 scrollbar-hide"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {renderContent()}
    </div>
  )
}
