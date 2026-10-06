export type SearchSlot = { id: string; label: string; modal: boolean; priority: number };

/** Highest priority wins; the most recently registered slot wins ties. */
export function activeSearchSlot(slots: SearchSlot[]): SearchSlot | undefined {
  return slots.reduce<SearchSlot | undefined>((chosen, slot) =>
    !chosen || slot.priority >= chosen.priority ? slot : chosen, undefined);
}