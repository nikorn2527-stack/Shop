"use client";

/**
 * PagePlaceholder — minimal "เร็ว ๆ นี้" panel used for views that haven't been
 * built yet (Pos / Stock / Reports) so the AppShell can lazy-load them without
 * breaking navigation.
 */

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Construction } from "lucide-react";
import { SectionHeader } from "@/components/shared/SectionHeader";

interface PagePlaceholderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  hint?: string;
}

export function PagePlaceholder({
  title,
  description,
  icon: Icon = Construction,
  hint = "เร็ว ๆ นี้",
}: PagePlaceholderProps) {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="โมดูลนี้กำลังพัฒนา"
        title={title}
        description={description}
      />
      <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 p-10 text-center">
        <div className="mx-auto size-12 rounded-xl bg-emerald-100 text-emerald-700 grid place-items-center">
          <Icon className="size-6" aria-hidden="true" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          โมดูลนี้กำลังอยู่ระหว่างการพัฒนา · จะเปิดให้ใช้งาน{hint}
        </p>
      </div>
    </div>
  );
}

export default PagePlaceholder;
