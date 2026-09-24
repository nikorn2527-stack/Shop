"use client";

/**
 * ConfirmDialog — confirmation modal built on shadcn AlertDialog.
 *
 * Usage:
 *   <ConfirmDialog
 *     open={open}
 *     title="ลบสินค้า"
 *     description="การลบไม่สามารถย้อนกลับได้"
 *     confirmLabel="ลบ"
 *     onConfirm={handleDelete}
 *     onCancel={() => setOpen(false)}
 *   />
 */

import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export type ConfirmTone = "default" | "danger";

export interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** Disable the confirm button (e.g. while a request is in-flight). */
  pending?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export function ConfirmDialog({
  open,
  title = "ยืนยันการกระทำ",
  description,
  confirmLabel = "ยืนยัน",
  cancelLabel = "ยกเลิก",
  tone = "default",
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel?.();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description !== undefined && (
            <AlertDialogDescription asChild>
              <span className="block text-sm text-muted-foreground">
                {description}
              </span>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Prevent auto-close: parent controls `open` state.
              event.preventDefault();
              onConfirm?.();
            }}
            disabled={pending}
            className={cn(
              tone === "danger" &&
                "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-200",
            )}
          >
            {pending ? "กำลังดำเนินการ…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
