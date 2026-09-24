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
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1 min-w-0">
        {eyebrow ? (
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-700">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight text-foreground truncate">
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
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
