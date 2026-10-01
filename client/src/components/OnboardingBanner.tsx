import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleCheck,
  Rocket,
  UserPlus,
  PackagePlus,
  ShoppingCartSimple,
  X,
} from "@/lib/icons";
import type { View } from "../pages/pageData";

/**
 * OnboardingBanner — shows on the Dashboard when the store is in an early
 * state (no products / no members / no sales yet). Renders a friendly
 * step-by-step checklist that jumps the user to the right view when clicked.
 *
 * Hidden automatically once the store has products AND members AND sales.
 * Each step shows a green check when its target count > 0.
 *
 * Persisted dismissal: stores `onboarding-dismissed` in localStorage so the
 * banner doesn't reappear after the user dismisses it (until they reset
 * settings, which clears localStorage too in some flows).
 */
export type OnboardingProgress = {
  productCount: number;
  memberCount: number;
  salesCount: number;
};

export function OnboardingBanner({
  progress,
  setView,
}: {
  progress: OnboardingProgress;
  setView: (view: View) => void;
}) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("onboarding-dismissed") === "1";
    } catch {
      return false;
    }
  });

  // Compute completion for each step
  const steps = useMemo(() => {
    return [
      {
        id: "products",
        label: "เพิ่มสินค้าเข้าระบบ",
        detail: "สร้างรายการสินค้าที่จะขาย · ตั้งราคา หน่วย และสต็อก",
        cta: "ไปที่สต็อกสินค้า",
        view: "stock" as View,
        icon: PackagePlus,
        done: progress.productCount > 0,
        count: progress.productCount,
        countLabel: "สินค้า",
      },
      {
        id: "members",
        label: "ลงทะเบียนสมาชิก",
        detail: "สมาชิกใช้บัตรเงินสด · เติมเงินและหักบัญชีได้ที่ POS",
        cta: "ไปที่สมาชิกและบัญชี",
        view: "members" as View,
        icon: UserPlus,
        done: progress.memberCount > 0,
        count: progress.memberCount,
        countLabel: "สมาชิก",
      },
      {
        id: "sales",
        label: "ทำการขายครั้งแรก",
        detail: "ขายสินค้าผ่าน POS · รับเงินสด/QR/หักบัญชี · พิมพ์ใบเสร็จได้ทันที",
        cta: "ไปที่หน้าร้าน / POS",
        view: "pos" as View,
        icon: ShoppingCartSimple,
        done: progress.salesCount > 0,
        count: progress.salesCount,
        countLabel: "บิล",
      },
    ];
  }, [progress]);

  const allDone = steps.every((step) => step.done);

  // Hide if dismissed OR everything is done (with a small grace period — show
  // a celebratory "All done" state for one render before vanishing)
  if (dismissed) return null;
  if (allDone) {
    // Show a brief "complete" celebration state, then disappear
    return (
      <section className="onboarding-banner complete" aria-label="เริ่มต้นใช้งานเสร็จสมบูรณ์">
        <div className="onboarding-icon-wrap">
          <CircleCheck size={22} weight="duotone" />
        </div>
        <div className="onboarding-body">
          <span className="eyebrow">SETUP COMPLETE · พร้อมใช้งาน</span>
          <h2>ระบบพร้อมใช้งานแล้ว — เริ่มขายและติดตามยอดได้เลย</h2>
          <p>ตัวเลขสรุปจะแสดงที่นี่เมื่อมีการขายจริง · ใช้เมนูด้านซ้ายเพื่อเข้าถึงแต่ละส่วนของระบบ</p>
        </div>
        <button
          className="outline-button"
          onClick={() => setView("pos")}
        >
          <ShoppingCartSimple size={16} /> เริ่มขาย
        </button>
        <button
          className="icon-button"
          aria-label="ปิดแถบต้อนรับ"
          onClick={() => {
            try { localStorage.setItem("onboarding-dismissed", "1"); } catch {}
            setDismissed(true);
          }}
        >
          <X size={16} />
        </button>
      </section>
    );
  }

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section className="onboarding-banner" aria-label="แนะนำการเริ่มต้นใช้งาน">
      <div className="onboarding-icon-wrap">
        <Rocket size={22} weight="duotone" />
      </div>
      <div className="onboarding-body">
        <div className="onboarding-head">
          <div>
            <span className="eyebrow">GETTING STARTED · ตั้งค่าร้านครั้งแรก</span>
            <h2>เริ่มต้นใช้งาน {doneCount}/{steps.length} ขั้นตอน</h2>
          </div>
          <div className="onboarding-progress" aria-hidden="true">
            <div
              className="onboarding-progress-bar"
              style={{ width: `${(doneCount / steps.length) * 100}%` }}
            />
          </div>
        </div>
        <div className="onboarding-steps">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <button
                key={step.id}
                className={`onboarding-step${step.done ? " done" : ""}`}
                onClick={() => setView(step.view)}
                title={step.detail}
              >
                <span className="step-icon">
                  {step.done ? <Check size={16} weight="bold" /> : <Icon size={16} />}
                </span>
                <span className="step-text">
                  <b>{step.label}</b>
                  <small>{step.detail}</small>
                </span>
                <span className={`step-count${step.done ? " done" : ""}`}>
                  {step.count > 0 ? <><b>{step.count}</b> {step.countLabel}</> : <><ArrowRight size={13} /> {step.cta}</>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <button
        className="icon-button onboarding-close"
        aria-label="ปิดแถบต้อนรับ"
        onClick={() => {
          try { localStorage.setItem("onboarding-dismissed", "1"); } catch {}
          setDismissed(true);
        }}
      >
        <X size={16} />
      </button>
    </section>
  );
}
