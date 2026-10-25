import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { workspaceViewport } from "@/lib/workspaceViewport";
import "@/styles/workspace-viewport.css";

/** The browsing context stays mounted when resizing or rotating, preserving drafts.
 * Its own viewport keeps desktop media queries, portals and fixed dialogs consistent.
 * It shares this origin's cookies/storage; this is display sizing, never an auth boundary.
 */
export function WorkspaceViewport() {
  const frame = useRef<HTMLIFrameElement>(null);
  const observer = useRef<MutationObserver | null>(null);
  const measure = () =>
    workspaceViewport(
      window.innerWidth,
      window.visualViewport?.height ?? window.innerHeight,
      window.matchMedia("(any-pointer: coarse)").matches
    );
  const [layout, setLayout] = useState(measure);
  const [source] = useState(() => window.location.href);
  useLayoutEffect(() => {
    const media = window.matchMedia("(any-pointer: coarse)");
    const update = () => setLayout(measure());
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    media.addEventListener("change", update);
    update();
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      media.removeEventListener("change", update);
    };
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return (
    <div
      className="workspace-viewport"
      data-workspace-layout="proportional-v1"
      data-mode={layout.mode}
      data-scale={layout.scale}
    >
      <iframe
        ref={frame}
        name="shop-workspace"
        title="ระบบร้านค้า"
        data-shop-workspace="1"
        src={source}
        allow="camera; fullscreen"
        allowFullScreen
        style={{
          width: layout.width,
          height: layout.height,
          left: layout.left,
          top: layout.top,
          transform: `scale(${layout.scale})`,
        }}
        onLoad={() => {
          observer.current?.disconnect();
          const document = frame.current?.contentDocument;
          if (document) {
            const syncTitle = () => {
              window.document.title = document.title;
            };
            syncTitle();
            const title = document.querySelector("title");
            if (title) {
              observer.current = new MutationObserver(syncTitle);
              observer.current.observe(title, {
                childList: true,
                subtree: true,
                characterData: true,
              });
            }
          }
          frame.current?.contentWindow?.focus();
        }}
      />
    </div>
  );
}
