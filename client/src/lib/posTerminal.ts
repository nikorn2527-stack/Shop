import { createBrowserUuid } from "./browserUuid";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

const DEVICE_KEY = "shop-pos-device-id-v1";
/** Browser registration, not hardware identity or an authentication credential. */
function readDeviceId(): string | null {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (
      saved &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        saved
      )
    )
      return saved;
    const id = createBrowserUuid();
    localStorage.setItem(DEVICE_KEY, id);
    return localStorage.getItem(DEVICE_KEY) === id ? id : null;
  } catch {
    return null;
  }
}
export function usePosTerminal() {
  const [deviceId] = useState(readDeviceId);
  const policy = trpc.system.experience.useQuery();
  const query = trpc.pos.terminal.useQuery(
    { deviceId: deviceId ?? "" },
    { enabled: !!deviceId, refetchOnWindowFocus: true }
  );
  return { deviceId, requireRegistration: policy.data?.requirePosRegistration ?? true, ...query };
}
export function terminalLabel(number: number) {
  return `จุดขายที่ ${String(number).padStart(2, "0")}`;
}
