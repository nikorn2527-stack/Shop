"use client";

/**
 * RegisterMemberModal — quick register form for a new member.
 *
 * Submits to POST /api/members (the same route handles create + edit by
 * passing memberNumber). Uses react-hook-form + zod + PasswordMeter-style
 * inline validation messages.
 */

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/lib/api-client";

const schema = z.object({
  prename: z.string().max(20).optional(),
  firstName: z.string().min(1, "กรุณาระบุชื่อ").max(100),
  lastName: z.string().min(1, "กรุณาระบุนามสกุล").max(100),
  type: z.string().max(40).optional(),
  phone: z.string().max(20).optional(),
  idCard: z.string().max(20).optional(),
  gender: z.string().max(20).optional(),
  creditLimit: z.number().min(0).max(1_000_000).nullable().optional(),
  cardNumber: z.string().max(20).optional(),
  patientCode: z.string().max(20).optional(),
  initialDeposit: z.number().min(0).optional(),
});

type FormValues = z.infer<typeof schema>;

interface RegisterMemberModalProps {
  onClose: () => void;
  onCreated: (memberNumber: string) => void | Promise<void>;
}

const PRENAMES = ["นาย", "นาง", "นางสาว", "ด.ช.", "ด.ญ."];

export function RegisterMemberModal({ onClose, onCreated }: RegisterMemberModalProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      prename: "",
      firstName: "",
      lastName: "",
      type: "สมาชิก",
      phone: "",
      idCard: "",
      gender: "",
      creditLimit: null,
      cardNumber: "",
      patientCode: "",
      initialDeposit: 0,
    },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      const res = await apiPost<{ member: { memberNumber: string } }>("/api/members", values);
      toast.success("ลงทะเบียนสมาชิกสำเร็จ", {
        description: `เลขสมาชิกใหม่ · ${res.member.memberNumber}`,
      });
      await onCreated(res.member.memberNumber);
    } catch (err) {
      toast.error("ลงทะเบียนไม่สำเร็จ", {
        description: err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
      });
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-5 text-emerald-600" aria-hidden="true" />
            ลงทะเบียนสมาชิกใหม่
          </DialogTitle>
          <DialogDescription>
            กรอกข้อมูลพื้นฐาน · เลขสมาชิกจะถูกสร้างอัตโนมัติตามรูปแบบที่ตั้งค่าไว้
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="prename">คำนำหน้า</Label>
              <Input id="prename" list="prenames" {...register("prename")} placeholder="นาย / นางสาว" />
              <datalist id="prenames">
                {PRENAMES.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label htmlFor="type">ประเภท</Label>
              <Input id="type" {...register("type")} placeholder="สมาชิก" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="firstName">ชื่อ *</Label>
              <Input id="firstName" {...register("firstName")} aria-invalid={!!errors.firstName} />
              {errors.firstName ? (
                <p className="text-xs text-red-600">{errors.firstName.message}</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="lastName">นามสกุล *</Label>
              <Input id="lastName" {...register("lastName")} aria-invalid={!!errors.lastName} />
              {errors.lastName ? (
                <p className="text-xs text-red-600">{errors.lastName.message}</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="phone">เบอร์โทร</Label>
              <Input id="phone" {...register("phone")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="idCard">เลขบัตรประชาชน</Label>
              <Input id="idCard" {...register("idCard")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gender">เพศ</Label>
              <select
                id="gender"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                value={watch("gender") || ""}
                onChange={(e) => setValue("gender", e.target.value)}
              >
                <option value="">ไม่ระบุ</option>
                <option value="ชาย">ชาย</option>
                <option value="หญิง">หญิง</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="creditLimit">วงเงินเครดิต (ว่าง = ไม่จำกัด)</Label>
              <Input
                id="creditLimit"
                type="number"
                step="0.01"
                min="0"
                {...register("creditLimit", {
                  setValueAs: (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
                })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cardNumber">เลขบัตรเงินสด</Label>
              <Input id="cardNumber" {...register("cardNumber")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="patientCode">HN</Label>
              <Input id="patientCode" {...register("patientCode")} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label htmlFor="initialDeposit">เงินฝากเริ่มแรก (บาท)</Label>
              <Input
                id="initialDeposit"
                type="number"
                step="0.01"
                min="0"
                {...register("initialDeposit", {
                  setValueAs: (v) => (v === "" || v === null || v === undefined ? 0 : Number(v)),
                })}
              />
              <p className="text-xs text-muted-foreground">เติมเงินครั้งแรกให้สมาชิกใหม่ทันที (ถ้ามี)</p>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={isSubmitting}>
              ยกเลิก
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={isSubmitting}
            >
              {isSubmitting ? "กำลังบันทึก…" : "ลงทะเบียน"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default RegisterMemberModal;
