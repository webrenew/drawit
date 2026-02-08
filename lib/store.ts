import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { CanvasElement, SmartConnection } from "@/lib/types"
import { diagramService, type Diagram } from "@/lib/services/diagram-service"
import { debounce } from "@/lib/utils/debounce"
import { createClient } from "@/lib/supabase/client"

// Auto-save delay in milliseconds
const AUTO_SAVE_DELAY = 2000

interface CanvasState {
  elements: CanvasElement[]
  connections: SmartConnection[]
  _hasHydrated: boolean

  // Diagram persistence state
  currentDiagramId: string | null
  currentDiagram: Diagram | null
  isSaving: boolean
  lastSaved: Date | null
  saveError: string | null
  isLoading: boolean

  // Element actions
  addElement: (element: CanvasElement) => void
  updateElements: (updater: (elements: CanvasElement[]) => CanvasElement[]) => void
  clearElements: () => void

  // Connection actions
  addConnection: (connection: SmartConnection) => void
  updateConnections: (updater: (connections: SmartConnection[]) => SmartConnection[]) => void
  clearConnections: () => void

  // Bulk actions
  clearAll: () => void
  setCanvasState: (elements: CanvasElement[], connections: SmartConnection[]) => void

  // Diagram persistence actions
  loadDiagram: (id: string) => Promise<void>
  saveDiagram: () => Promise<void>
  createNewDiagram: (title?: string) => Promise<string | null>
  updateDiagramTitle: (title: string) => Promise<void>
  closeDiagram: () => void
  setDiagram: (diagram: Diagram | null) => void

  setHasHydrated: (state: boolean) => void
}

// Debounced auto-save function (created outside store to maintain reference)
let debouncedAutoSave: ReturnType<typeof debounce> | null = null

// Track if we're in the process of auto-creating a diagram
let isAutoCreating = false

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => {
      let hasPendingSave = false

      // Auto-create diagram for logged-in users
      const ensureDiagramExists = async () => {
        const state = get()
        
        // Already have a diagram or already creating one
        if (state.currentDiagramId || isAutoCreating || state.isLoading) {
          return
        }

        // Check if user is logged in
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        
        if (!user) {
          // Not logged in, skip auto-create
          return
        }

        // Auto-create a new diagram
        isAutoCreating = true
        try {
          const diagram = await diagramService.create({
            title: "Untitled Diagram",
            elements: state.elements,
            connections: state.connections,
          })
          set({
            currentDiagramId: diagram.id,
            currentDiagram: diagram,
            lastSaved: new Date(),
          })
          console.log("Auto-created diagram:", diagram.id)
        } catch (error) {
          console.error("Failed to auto-create diagram:", error)
        } finally {
          isAutoCreating = false
        }
      }

      // Save to Supabase
      const saveToSupabase = async () => {
        const state = get()
        if (!state.currentDiagramId) {
          hasPendingSave = false
          return
        }

        if (state.isSaving) {
          hasPendingSave = true
          return
        }

        set({ isSaving: true, saveError: null })
        try {
          await diagramService.autoSave(
            state.currentDiagramId,
            state.elements,
            state.connections
          )
          set({ isSaving: false, lastSaved: new Date() })
        } catch (error) {
          console.error("Auto-save to Supabase failed:", error)
          set({ 
            isSaving: false, 
            saveError: error instanceof Error ? error.message : "Save failed" 
          })
        } finally {
          if (hasPendingSave) {
            hasPendingSave = false
            void saveToSupabase()
          }
        }
      }

      // Initialize debounced auto-save
      const triggerAutoSave = () => {
        const state = get()
        if (state.currentDiagramId) {
          saveToSupabase()
        } else {
          // Try to auto-create diagram first
          ensureDiagramExists().then(() => {
            const newState = get()
            if (newState.currentDiagramId) {
              saveToSupabase()
            }
          })
        }
      }

      debouncedAutoSave = debounce(triggerAutoSave, AUTO_SAVE_DELAY)

      return {
        elements: [],
        connections: [],
        _hasHydrated: false,

        // Diagram persistence state
        currentDiagramId: null,
        currentDiagram: null,
        isSaving: false,
        lastSaved: null,
        saveError: null,
        isLoading: false,

        addElement: (element) => {
          set((state) => ({
            elements: [...state.elements, element],
          }))
          debouncedAutoSave?.()
        },

        updateElements: (updater) => {
          set((state) => ({
            elements: updater(state.elements),
          }))
          debouncedAutoSave?.()
        },

        clearElements: () => {
          set({ elements: [] })
          if (get().currentDiagramId) {
            debouncedAutoSave?.()
          }
        },

        addConnection: (connection) => {
          set((state) => ({
            connections: [...state.connections, connection],
          }))
          debouncedAutoSave?.()
        },

        updateConnections: (updater) => {
          set((state) => ({
            connections: updater(state.connections),
          }))
          debouncedAutoSave?.()
        },

        clearConnections: () => {
          set({ connections: [] })
          if (get().currentDiagramId) {
            debouncedAutoSave?.()
          }
        },

        clearAll: () => {
          set({ elements: [], connections: [] })
          if (get().currentDiagramId) {
            debouncedAutoSave?.()
          }
        },

        setCanvasState: (elements, connections) => {
          set({ elements, connections })
          if (get().currentDiagramId) {
            debouncedAutoSave?.()
          }
        },

        loadDiagram: async (id: string) => {
          set({ isLoading: true, saveError: null })
          try {
            const diagram = await diagramService.get(id)
            if (diagram) {
              set({
                elements: diagram.elements,
                connections: diagram.connections,
                currentDiagramId: diagram.id,
                currentDiagram: diagram,
                isLoading: false,
              })
            } else {
              set({ isLoading: false, saveError: "Diagram not found" })
            }
          } catch (error) {
            console.error("Failed to load diagram:", error)
            set({
              isLoading: false,
              saveError: error instanceof Error ? error.message : "Failed to load diagram",
            })
          }
        },

        saveDiagram: async () => {
          const state = get()
          if (!state.currentDiagramId) {
            // Try to create one first
            await ensureDiagramExists()
          }
          
          const newState = get()
          if (!newState.currentDiagramId) return

          set({ isSaving: true, saveError: null })
          try {
            await diagramService.autoSave(
              newState.currentDiagramId,
              newState.elements,
              newState.connections
            )
            set({ isSaving: false, lastSaved: new Date() })
          } catch (error) {
            console.error("Failed to save diagram:", error)
            set({
              isSaving: false,
              saveError: error instanceof Error ? error.message : "Failed to save diagram",
            })
          }
        },

        createNewDiagram: async (title?: string) => {
          set({ isLoading: true, saveError: null })
          try {
            const diagram = await diagramService.create({
              title: title || "Untitled Diagram",
              elements: get().elements,
              connections: get().connections,
            })
            set({
              currentDiagramId: diagram.id,
              currentDiagram: diagram,
              isLoading: false,
              lastSaved: new Date(),
            })
            return diagram.id
          } catch (error) {
            console.error("Failed to create diagram:", error)
            set({
              isLoading: false,
              saveError: error instanceof Error ? error.message : "Failed to create diagram",
            })
            return null
          }
        },

        updateDiagramTitle: async (title: string) => {
          const state = get()
          if (!state.currentDiagramId) return

          try {
            const updated = await diagramService.update(state.currentDiagramId, { title })
            set({ currentDiagram: updated })
          } catch (error) {
            console.error("Failed to update diagram title:", error)
          }
        },

        closeDiagram: () => {
          // Flush any pending auto-save
          debouncedAutoSave?.flush()
          set({
            currentDiagramId: null,
            currentDiagram: null,
            lastSaved: null,
            saveError: null,
          })
        },

        setDiagram: (diagram: Diagram | null) => {
          if (diagram) {
            set({
              elements: diagram.elements,
              connections: diagram.connections,
              currentDiagramId: diagram.id,
              currentDiagram: diagram,
            })
          } else {
            set({
              currentDiagramId: null,
              currentDiagram: null,
            })
          }
        },

        setHasHydrated: (state) => set({ _hasHydrated: state }),
      }
    },
    {
      name: "canvas-storage",
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
      partialize: (state) => ({
        elements: state.elements,
        connections: state.connections,
        // Don't persist diagram ID - user should explicitly open diagrams
      }),
    }
  )
)

// Export selectors for convenience
export const useElements = () => useCanvasStore((state) => state.elements)
export const useConnections = () => useCanvasStore((state) => state.connections)
export const useHasHydrated = () => useCanvasStore((state) => state._hasHydrated)
export const useCurrentDiagram = () => useCanvasStore((state) => state.currentDiagram)
export const useIsSaving = () => useCanvasStore((state) => state.isSaving)
export const useLastSaved = () => useCanvasStore((state) => state.lastSaved)
