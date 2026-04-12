import { useFridgeStore } from '../store/fridgeStore'

interface FocusCabinetItemOptions {
  cabinetId: string
  itemId: string
  shelfId?: string | null
  clearHighlightAfterMs?: number
}

export async function focusCabinetItem({
  cabinetId,
  itemId,
  shelfId,
  clearHighlightAfterMs = 6000,
}: FocusCabinetItemOptions): Promise<string | null> {
  const store = useFridgeStore.getState()
  store.setMode('VIEW')
  store.setFocusedShelfId(null)

  await store.loadCabinet(cabinetId)

  const resolvedShelfId = shelfId ?? useFridgeStore.getState().shelves.find((candidateShelf) =>
    candidateShelf.items.some((item) => item.id === itemId),
  )?.id ?? null

  useFridgeStore.getState().setFocusedShelfId(resolvedShelfId)
  useFridgeStore.getState().setHighlightedItemId(itemId)

  window.setTimeout(() => {
    if (useFridgeStore.getState().highlightedItemId === itemId) {
      useFridgeStore.getState().setHighlightedItemId(null)
    }
  }, clearHighlightAfterMs)

  return resolvedShelfId
}
