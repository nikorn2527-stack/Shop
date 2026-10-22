import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const MAX_SCALE = 0.88;

/** Shared responsive viewport for the 794×1123px A4 report document. */
export function A4DocumentPreview({
  html,
  label,
  children,
}: {
  html?: string;
  label: string;
  children?: ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const documentObserverRef = useRef<ResizeObserver | null>(null);
  const [scale, setScale] = useState(MAX_SCALE);
  const [height, setHeight] = useState(A4_HEIGHT_PX);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const updateScale = () => {
      const availableWidth = Math.max(1, stage.clientWidth - 32);
      setScale(Math.min(MAX_SCALE, availableWidth / A4_WIDTH_PX));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(stage);
    const content = contentRef.current;
    const contentObserver = new ResizeObserver(() => {
      if (content) setHeight(Math.max(A4_HEIGHT_PX, content.scrollHeight));
    });
    if (content) contentObserver.observe(content);
    return () => {
      observer.disconnect();
      contentObserver.disconnect();
    };
  }, []);

  const measureFrame = useCallback(() => {
    documentObserverRef.current?.disconnect();
    const frame = iframeRef.current;
    const document = frame?.contentDocument;
    if (!frame || !document?.body) return;
    const measure = () => {
      if (frame.isConnected && frame.contentDocument === document) {
        setHeight(Math.max(A4_HEIGHT_PX, document.body.scrollHeight));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    documentObserverRef.current = observer;
    void document.fonts.ready.then(measure);
  }, []);
  useEffect(() => () => documentObserverRef.current?.disconnect(), []);

  return (
    <div
      ref={stageRef}
      style={{ width: "100%", minWidth: 0 }}
      className="document-preview-stage document-preview-stage-a4 export-doc-preview"
      role="tabpanel"
      aria-label={label}
    >
      <div
        className="export-doc-scaler"
        style={{ width: A4_WIDTH_PX * scale, height: height * scale }}
      >
        {html !== undefined ? (
          <iframe
            ref={iframeRef}
            onLoad={measureFrame}
            title={label}
            srcDoc={html}
            className="export-doc-iframe"
            style={{ transform: `scale(${scale})`, height }}
            loading="lazy"
          />
        ) : (
          <div
            ref={contentRef}
            className="a4-preview-content"
            style={{ transform: `scale(${scale})` }}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
