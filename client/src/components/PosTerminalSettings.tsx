import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { terminalLabel, usePosTerminal } from "@/lib/posTerminal";
import "./PosTerminalSettings.css";

export function PosTerminalSettings({
  canManage,
  locked = false,
}: {
  canManage: boolean;
  locked?: boolean;
}) {
  const terminal = usePosTerminal();
  const list = trpc.pos.terminals.useQuery();
  const utils = trpc.useUtils();
  const [number, setNumber] = useState<string | null>(null);
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const refresh = async () => {
    await Promise.all([
      utils.pos.terminal.invalidate(),
      utils.pos.terminals.invalidate(),
    ]);
  };
  const register = trpc.pos.registerTerminal.useMutation({
    onSuccess: async result => {
      setMessage(`กำหนดเครื่องนี้เป็น${terminalLabel(result.number)}แล้ว`);
      setNumber(null);
      await refresh();
    },
  });
  const release = trpc.pos.releaseTerminal.useMutation({
    onSuccess: async () => {
      setReleaseId(null);
      setMessage("ยกเลิกการผูกแล้ว ประวัติบิลเดิมยังอยู่ครบ");
      await refresh();
    },
  });
  const busy = locked || register.isPending || release.isPending;
  const error =
    register.error?.message ||
    release.error?.message ||
    terminal.error?.message ||
    list.error?.message;
  const chosen = Number(number ?? terminal.data?.number ?? 0);
  return (
    <section className="pos-terminal-settings">
      <div className="settings-heading">
        <div>
          <h2>จุดขายของเครื่องนี้</h2>
          <p>
            ผู้บริหารกำหนดเลขจุดขายให้แต่ละเบราว์เซอร์
            เลขเดียวกันใช้ได้หนึ่งเครื่องในระบบนี้
          </p>
        </div>
      </div>
      <div className="terminal-current" role="status">
        {!terminal.deviceId
          ? "บันทึกการตั้งค่าเครื่องไม่ได้ กรุณาอนุญาตพื้นที่จัดเก็บของเบราว์เซอร์"
          : terminal.isLoading
            ? "กำลังตรวจสอบจุดขาย…"
            : terminal.data
              ? terminalLabel(terminal.data.number)
              : "ยังไม่ได้กำหนดจุดขาย"}
      </div>
      <p className="terminal-help">
        ใช้รหัสที่ระบบจำไว้ในเบราว์เซอร์ ไม่ใช้ IP หรือ MAC ·
        หากเปลี่ยนเบราว์เซอร์หรือล้างข้อมูล ต้องลงทะเบียนใหม่
        เลขจุดขายจะติดไปกับบิล ส่วนผู้ขายใช้บัญชีที่เข้าสู่ระบบ
      </p>
      {error && (
        <div role="alert" className="notice-bar error">
          {error}
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {canManage ? (
        <form
          className="terminal-register"
          onSubmit={event => {
            event.preventDefault();
            if (
              busy ||
              !terminal.deviceId ||
              !Number.isInteger(chosen) ||
              chosen < 1 ||
              chosen > 999
            )
              return;
            register.reset();
            release.reset();
            setMessage("");
            register.mutate({ deviceId: terminal.deviceId, number: chosen });
          }}
        >
          <label>
            เลขจุดขาย (1–999)
            <input
              aria-label="เลขจุดขาย"
              type="number"
              min="1"
              max="999"
              step="1"
              required
              disabled={busy || !terminal.deviceId}
              value={number ?? terminal.data?.number ?? ""}
              onChange={event => setNumber(event.target.value)}
              placeholder="เช่น 1 หรือ 2"
            />
          </label>
          <button
            type="submit"
            className="primary-button"
            disabled={
              busy ||
              !terminal.deviceId ||
              !Number.isInteger(chosen) ||
              chosen < 1 ||
              chosen > 999
            }
          >
            {register.isPending ? "กำลังบันทึก…" : "กำหนดให้เครื่องนี้"}
          </button>
        </form>
      ) : (
        <p>ให้ผู้บริหารเข้าสู่ระบบบนเครื่องนี้เพื่อกำหนดจุดขาย</p>
      )}
      <h3>จุดขายที่ลงทะเบียนแล้ว</h3>
      {list.isLoading ? (
        <p>กำลังโหลด…</p>
      ) : list.data?.length === 0 ? (
        <p>ยังไม่มีจุดขายที่ลงทะเบียน</p>
      ) : (
        <ul className="terminal-list">
          {list.data?.map(row => (
            <li key={row.id}>
              <div>
                <b>
                  {terminalLabel(row.number)}
                  {terminal.data?.id === row.id ? " · เครื่องนี้" : ""}
                </b>
                <small>กำหนดโดย {row.registeredBy}</small>
              </div>
              {canManage && (
                <button
                  type="button"
                  className="outline-button"
                  disabled={busy}
                  onClick={() => {
                    release.reset();
                    register.reset();
                    setReleaseId(row.id);
                  }}
                >
                  ยกเลิกการผูก
                </button>
              )}
              {releaseId === row.id && (
                <div className="terminal-release-confirm" role="alert">
                  <p>
                    ยกเลิกการผูก{terminalLabel(row.number)}?
                    เครื่องเดิมจะชำระบิลใหม่ไม่ได้จนกว่าจะลงทะเบียนอีกครั้ง
                    ประวัติบิลเดิมยังคงอยู่
                  </p>
                  <button
                    type="button"
                    className="outline-button"
                    disabled={busy}
                    onClick={() => setReleaseId(null)}
                  >
                    กลับ
                  </button>
                  <button
                    type="button"
                    className="outline-button"
                    disabled={busy}
                    onClick={() => {
                      if (!busy) release.mutate({ id: row.id });
                    }}
                  >
                    ยืนยันยกเลิกการผูก
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
