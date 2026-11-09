import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { trpc } from "@/lib/trpc";
import { createBrowserUuid } from "@/lib/browserUuid";
import type {
  PrintDocumentRef,
  SlipVariant,
} from "@shared/storeTypes/documents";

export function useSlipDocument(
  document: PrintDocumentRef | null,
  initial: SlipVariant = "original"
) {
  const [variant, setVariant] = useState<SlipVariant>(initial);
  const pending = useRef<string | null>(null);
  const identity = document ? `${document.kind}:${document.key}` : "";
  const mutation = trpc.printing.issue.useMutation();
  useEffect(() => {
    setVariant(initial);
    pending.current = null;
  }, [identity, initial]);
  const beforePrint = async () => {
    if (!document)
      throw new Error("ไม่พบเลขอ้างอิงเอกสาร กรุณาเปิดจากประวัติรายการ");
    pending.current ??= createBrowserUuid();
    const issued = await mutation.mutateAsync({
      document,
      requestId: pending.current,
    });
    pending.current = null;
    // Native print and canvas read the live DOM immediately after this promise resolves.
    flushSync(() => setVariant(issued.variant));
  };
  return { variant, setVariant, beforePrint };
}
