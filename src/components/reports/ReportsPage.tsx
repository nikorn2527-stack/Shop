"use client";

/**
 * ReportsPage — placeholder until Task 7 ships the real reports module.
 *
 * Mirrors the original Shop's Reports view shell so navigation from the
 * dashboard / sidebar lands somewhere coherent.
 */

import { BarChart3, Download } from "lucide-react";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export function ReportsPage() {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="รายงาน"
        title="วิเคราะห์และส่งออก"
        description="รายงานยอดขาย · กำไร · สต็อกคงคลัง · เครื่องรายได้"
        actions={<Download className="size-4 text-muted-foreground" aria-hidden="true" />}
      />
      <PagePlaceholder
        title="รายงาน"
        icon={BarChart3}
        description="โมดูลรายงานกำลังพัฒนาโดย Task 7 — จะเปิดใช้งานเร็ว ๆ นี้"
        hint="เร็ว ๆ นี้"
      />
    </div>
  );
}

export default ReportsPage;
