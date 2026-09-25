"use client";

/**
 * SectionHeader — page/section header with eyebrow + title + description +
 * optional right-aligned actions. Mirrors the `SectionHeader` from the original
 * Shop's `PagePrimitives.tsx` but rendered with shadcn/ui tokens.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: SectionHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between gap-[20px] mb-[16px]",
        className,
      )}
    >
      <div className="space-y-1 min-w-0">
        {eyebrow ? (
          <p className="text-[10.5px] font-medium uppercase tracking-[0.2px] text-[#84887a]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-[22px] font-bold tracking-tight text-[#3d4a43] truncate">
          {title}
        </h1>
        {description ? (
          <p className="text-[12px] text-[#868a7b] leading-relaxed max-w-[520px]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export default SectionHeader;
