import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { activeSearchSlot, type SearchSlot } from "@/lib/sharedSearch";

type Slot = SearchSlot;
type SearchContext = { host: HTMLDivElement | null; active: Slot | undefined; register: (slot: Slot) => () => void };
const Context = createContext<SearchContext | null>(null);
const HostContext = createContext<((host: HTMLDivElement | null) => void) | null>(null);

/** Keeps the original search/confirmation handlers and gives modal searches precedence. */
export function SharedSearchProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const register = useRef((slot: Slot) => {
    setSlots(current => [...current.filter(item => item.id !== slot.id), slot]);
    return () => setSlots(current => current.filter(item => item.id !== slot.id));
  }).current;
  const active = activeSearchSlot(slots);
  return <Context.Provider value={{ host, active, register }}>
    <HostContext.Provider value={setHost}>{children}</HostContext.Provider>
  </Context.Provider>;
}

export function SharedSearchHost({ fallback }: { fallback: ReactNode }) {
  const context = useContext(Context);
  const setHost = useContext(HostContext);
  const [blocked, setBlocked] = useState(false);
  const [heading, setHeading] = useState<Element | null>(null);
  useEffect(() => {
    const update = () => {
      setBlocked(!!document.querySelector('[role="dialog"], .modal-backdrop'));
      setHeading(document.querySelector('.page-content [data-pos-search-host]') ?? document.querySelector('.page-content .section-header:not(.modal-backdrop .section-header)'));
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role", "class"] });
    update();
    return () => observer.disconnect();
  }, []);
  const search = <div className="shared-search-host" inert={blocked}>
    <small className="shared-search-label">{context?.active?.label ?? "ค้นหาทุกเมนู"}</small>
    <div ref={setHost} />
    {!context?.active && fallback}
    {context?.active?.modal && <span className="shared-search-modal-status">ค้นหาในหน้าต่างที่เปิดอยู่</span>}
  </div>;
  return heading ? createPortal(search, heading) : search;
}

export function SharedSearch({ children, label, priority = 10, enabled = true }: {
  children: ReactNode; label: string; priority?: number; enabled?: boolean;
}) {
  const context = useContext(Context);
  const id = useId();
  const anchor = useRef<HTMLDivElement | null>(null);
  const [modal, setModal] = useState(false);
  const register = context?.register;
  useLayoutEffect(() => {
    if (!enabled || !register) return;
    const inModal = !!anchor.current?.closest('[role="dialog"], .modal-backdrop');
    setModal(inModal);
    return register({ id, label, modal: inModal, priority: priority + (inModal ? 100 : 0) });
  }, [enabled, register, id, label, priority]);
  if (!context || !enabled) return <>{children}</>;
  const active = enabled && context.active?.id === id;
  return <div ref={anchor} className={modal && active ? "shared-search-local" : "shared-search-anchor"}>
    {modal ? <div hidden={!active}>{children}</div> : context.host ? createPortal(
      <div hidden={!active}>{children}</div>, context.host
    ) : null}
  </div>;
}