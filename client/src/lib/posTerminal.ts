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
    // getRandomValues also works on HTTP LAN installations without randomUUID.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, n => n.toString(16).padStart(2, "0")).join(
      ""
    );
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
