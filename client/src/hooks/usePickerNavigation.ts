import { useEffect, useId, useState, type KeyboardEvent } from "react";

/** Keep focus in the scanner input while navigating selectable suggestions. */
export function usePickerNavigation({ keys, open, onOpen, onClose, onPick, onCommit }: {
  keys: string[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPick: (key: string) => void;
  onCommit: () => void;
}) {
  const listId = useId();
  const [highlight, setHighlight] = useState<string | null>(null);
  const activeKey = open && highlight !== null && keys.includes(highlight) ? highlight : null;
  const optionId = (key: string) => `${listId}-${encodeURIComponent(key)}`;
  const reset = () => setHighlight(null);
  useEffect(() => { if (!open) setHighlight(null); }, [open]);
  useEffect(() => {
    if (activeKey === null) return;
    const option = document.getElementById(optionId(activeKey));
    const list = document.getElementById(listId);
    if (!option || !list) return;
    // Scroll only the suggestions, so wide product names cannot move the form.
    const row = option.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom;
    else if (row.top < bounds.top) list.scrollTop += row.top - bounds.top;
  }, [activeKey, listId]);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      onOpen();
      const current = activeKey === null ? -1 : keys.indexOf(activeKey);
      const index = current < 0 ? (event.key === "ArrowDown" ? 0 : keys.length - 1)
        : Math.max(0, Math.min(keys.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
      setHighlight(keys[index] ?? null);
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (activeKey !== null) onPick(activeKey);
      else onCommit(); // Preserve exact barcode and single-result scanning.
      reset();
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      reset();
    } else if (event.key === "Tab") {
      onClose();
      reset();
    }
  };
  return { listId, activeKey, optionId, reset, onKeyDown, inputProps: {
    role: "combobox" as const,
    "aria-autocomplete": "list" as const,
    "aria-expanded": open,
    "aria-controls": open ? listId : undefined,
    "aria-activedescendant": activeKey === null ? undefined : optionId(activeKey),
  } };
}
