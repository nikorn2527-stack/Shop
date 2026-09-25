"use client";

/**
 * SettingsPage — 4 sections × 13 tabs (receipt / payment / posmenu / member /
 * cutoff / alert / brand / display / roles / import / backup / edition / install / network).
 *
 * This MVP implements: receipt / payment / member / cutoff / alert / brand /
 * display / roles. Other tabs show a "เร็ว ๆ นี้" placeholder so the layout
 * matches the original Shop.
 *
 * Data: GET /api/settings  (returns StoreSettings)
 * Mutations: PATCH /api/settings
 * RBAC tab: reads SYSTEM_ROLES + PERMISSION_CATALOG from `@/lib/rbac` (no API
 * needed — system roles are static).
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CreditCard,
  Database,
  FileText,
  Layout,
  PackageSearch,
  Palette,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Store,
  Terminal,
  Upload,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";
import { SystemUpdateView } from "@/components/settings/SystemUpdateView";
import { apiGet, apiPatch } from "@/lib/api-client";
import { SYSTEM_ROLES, PERMISSION_CATALOG, roleLabel, type PermissionKey } from "@/lib/rbac";
import { cn } from "@/lib/utils";

interface StoreSettings {
  storeName: string;
  storeCode: string;
  appName: string;
  appTheme: string;
  appStyle: string;
  memberNumberMode: string;
  memberNumberPrefix: string;
  memberNumberYearMode: string;
  memberNumberYearDigits: number;
  memberNumberSeparator: string;
  memberNumberResetMonth: number;
  memberNumberSequenceDigits: number;
  dailyCutOffMode: string;
  dailyCutOffTime: string;
  receiptPaperWidth: string;
  showBalanceOnReceipt: boolean;
  lowBalanceAlert: boolean;
  lowBalanceThreshold: number;
  lowStockAlert: boolean;
  expiryAlert: boolean;
  expiryAlertDays: number;
  backupAutoEnabled: boolean;
  backupIntervalHours: number;
  backupKeepCount: number;
  promptpayId: string;
  helpPhone: string;
  posRailHidden: string;
  posShortcutKeys: string;
  devAccess: boolean;
  fontScale: string;
}

interface SettingsPageProps {
  role: string;
}

const SALE_TABS = [
  { id: "receipt", label: "ใบเสร็จ", icon: ReceiptText },
  { id: "payment", label: "การชำระเงิน", icon: CreditCard },
  { id: "posmenu", label: "เมนู POS", icon: Layout },
  { id: "member", label: "เลขสมาชิก", icon: UsersRound },
  { id: "cutoff", label: "รอบตัดยอด", icon: FileText },
  { id: "alert", label: "การแจ้งเตือน", icon: AlertTriangle },
] as const;

const STORE_TABS = [
  { id: "brand", label: "แบรนด์", icon: Store },
  { id: "display", label: "การแสดงผล", icon: Palette },
] as const;

const SYSTEM_TABS = [
  { id: "roles", label: "สิทธิ์การใช้งาน", icon: ShieldCheck },
  { id: "import", label: "นำเข้าข้อมูล", icon: Upload },
  { id: "backup", label: "สำรองข้อมูล", icon: Database },
  { id: "edition", label: "รุ่นระบบ", icon: Settings2 },
  { id: "system_update", label: "อัปเดตระบบ", icon: RefreshCw },
] as const;

const DEV_TABS = [
  { id: "install", label: "ติดตั้ง Add-on", icon: PackageSearch },
  { id: "network", label: "เครือข่าย", icon: Terminal },
] as const;

const THEMES = [
  { id: "emerald", label: "มรกต", color: "bg-emerald-500" },
  { id: "rose", label: "ชมพู", color: "bg-rose-500" },
  { id: "amber", label: "อำพัน", color: "bg-amber-500" },
  { id: "teal", label: "ฟ้าทะเล", color: "bg-teal-500" },
  { id: "violet", label: "ม่วง", color: "bg-violet-500" },
  { id: "lime", label: "เขียวมะนาว", color: "bg-lime-500" },
  { id: "orange", label: "ส้ม", color: "bg-orange-500" },
  { id: "stone", label: "หิน", color: "bg-stone-500" },
] as const;

const STYLES = [
  { id: "shop", label: "ร้านค้า" },
  { id: "minimal", label: "มินิมอล" },
  { id: "compact", label: "กระชับ" },
  { id: "playful", label: "สนุก" },
] as const;

export function SettingsPage({ role }: SettingsPageProps) {
  const qc = useQueryClient();
  const [section, setSection] = React.useState<"sale" | "store" | "system" | "dev">("sale");
  const [tab, setTab] = React.useState<string>("receipt");

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<StoreSettings>("/api/settings"),
  });
  const settings = settingsQuery.data;

  const [draft, setDraft] = React.useState<Partial<StoreSettings>>({});
  React.useEffect(() => {
    setDraft({});
  }, [settingsQuery.data]);

  const patchMutation = useMutation({
    mutationFn: async (patch: Partial<StoreSettings>) => {
      return apiPatch<StoreSettings>("/api/settings", patch);
    },
    onSuccess: () => {
      toast.success("บันทึกการตั้งค่าเรียบร้อย");
      setDraft({});
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err: unknown) => {
      toast.error("บันทึกไม่สำเร็จ", {
        description: err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
      });
    },
  });

  const value = <K extends keyof StoreSettings>(key: K): StoreSettings[K] =>
    (draft[key] ?? settings?.[key]) as StoreSettings[K];
  const update = <K extends keyof StoreSettings>(key: K, val: StoreSettings[K]) => {
    setDraft((d) => ({ ...d, [key]: val }));
  };

  const dirty = Object.keys(draft).length > 0;

  const handleSave = () => {
    if (!dirty) return;
    patchMutation.mutate(draft);
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="ตั้งค่า"
        title="ตั้งค่าร้านค้าและระบบ"
        description="ปรับแต่งการขาย · การแสดงผล · ความปลอดภัย · นำเข้า/สำรองข้อมูล"
        actions={
          <Button
            type="button"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={handleSave}
            disabled={!dirty || patchMutation.isPending}
          >
            {patchMutation.isPending ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
          </Button>
        }
      />

      {/* Section pills */}
      <div className="flex flex-wrap gap-1.5">
        <SectionPill id="sale" current={section} onSelect={(s) => { setSection(s); setTab("receipt"); }} label="การขายหน้าร้าน" />
        <SectionPill id="store" current={section} onSelect={(s) => { setSection(s); setTab("brand"); }} label="ร้านค้าและหน้าจอ" />
        <SectionPill id="system" current={section} onSelect={(s) => { setSection(s); setTab("roles"); }} label="ระบบและความปลอดภัย" />
        {role === "dev_service" || role === "administrator" ? (
          <SectionPill id="dev" current={section} onSelect={(s) => { setSection(s); setTab("install"); }} label="โซนผู้พัฒนา" />
        ) : null}
      </div>

      {settingsQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : settings ? (
        <>
          {section === "sale" ? (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="flex flex-wrap h-auto">
                {SALE_TABS.map((t) => (
                  <TabsTrigger key={t.id} value={t.id} className="text-xs">
                    <t.icon className="size-3.5" aria-hidden="true" />
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="receipt" className="mt-4">
                <Card className="py-0">
                  <CardContent className="p-6 space-y-4">
                    <h3 className="font-semibold">ขนาดกระดาษใบเสร็จ</h3>
                    <RadioCards
                      value={value("receiptPaperWidth")}
                      onChange={(v) => update("receiptPaperWidth", v)}
                      options={[
                        { value: "58", label: "58 มม.", hint: "กระดาษเล็ก" },
                        { value: "72", label: "72 มม.", hint: "มาตรฐาน" },
                        { value: "80", label: "80 มม.", hint: "ใบใหญ่" },
                      ]}
                    />
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <Label htmlFor="balance-receipt" className="font-medium">แสดงยอดคงเหลือในใบเสร็จ</Label>
                        <p className="text-xs text-muted-foreground">แสดงยอดเงินคงเหลือสมาชิกหลังหักบัญชี</p>
                      </div>
                      <Switch
                        id="balance-receipt"
                        checked={value("showBalanceOnReceipt")}
                        onCheckedChange={(c) => update("showBalanceOnReceipt", c)}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="payment" className="mt-4">
                <Card className="py-0">
                  <CardContent className="p-6 space-y-4">
                    <h3 className="font-semibold">PromptPay</h3>
                    <div className="space-y-2">
                      <Label htmlFor="promptpay-id">PromptPay ID</Label>
                      <Input
                        id="promptpay-id"
                        value={value("promptpayId") || ""}
                        onChange={(e) => update("promptpayId", e.target.value)}
                        placeholder="เบอร์โทรหรือเลขบัตรประชาชน 13 หลัก"
                      />
                      <p className="text-xs text-muted-foreground">
                        ใช้สร้าง QR Code สำหรับรับชำระเงินผ่านแอพธนาคาร
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="posmenu" className="mt-4">
                <PagePlaceholder title="เมนู POS" icon={Layout} hint="เร็ว ๆ นี้" />
              </TabsContent>
              <TabsContent value="member" className="mt-4">
                <Card className="py-0">
                  <CardContent className="p-6 space-y-4">
                    <h3 className="font-semibold">รูปแบบเลขสมาชิก</h3>
                    <div className="grid sm:grid-cols-2 gap-[13px]">
                      <div className="space-y-2">
                        <Label htmlFor="member-mode">รูปแบบ</Label>
                        <Select
                          value={value("memberNumberMode")}
                          onValueChange={(v) => update("memberNumberMode", v)}
                        >
                          <SelectTrigger id="member-mode"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="running">Running (เรียงเลข)</SelectItem>
                            <SelectItem value="year">ตามปี</SelectItem>
                            <SelectItem value="manual">กรอกเอง</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="member-prefix">คำนำหน้า</Label>
                        <Input
                          id="member-prefix"
                          value={value("memberNumberPrefix") || ""}
                          onChange={(e) => update("memberNumberPrefix", e.target.value)}
                          disabled={value("memberNumberMode") === "manual"}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="member-year-mode">รูปแบบปี</Label>
                        <Select
                          value={value("memberNumberYearMode")}
                          onValueChange={(v) => update("memberNumberYearMode", v)}
                          disabled={value("memberNumberMode") !== "year"}
                        >
                          <SelectTrigger id="member-year-mode"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">ไม่แสดง</SelectItem>
                            <SelectItem value="buddhist">พ.ศ.</SelectItem>
                            <SelectItem value="gregorian">ค.ศ.</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="member-year-digits">หลักปี</Label>
                        <Select
                          value={String(value("memberNumberYearDigits"))}
                          onValueChange={(v) => update("memberNumberYearDigits", Number(v) as 2 | 4)}
                          disabled={value("memberNumberMode") !== "year" || value("memberNumberYearMode") === "none"}
                        >
                          <SelectTrigger id="member-year-digits"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="2">2 หลัก</SelectItem>
                            <SelectItem value="4">4 หลัก</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="member-separator">ตัวคั่น</Label>
                        <Select
                          value={value("memberNumberSeparator") || "-"}
                          onValueChange={(v) => update("memberNumberSeparator", v)}
                        >
                          <SelectTrigger id="member-separator"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="-">-</SelectItem>
                            <SelectItem value="/">/</SelectItem>
                            <SelectItem value="_">_</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="member-reset">เดือนเริ่มรอบปี</Label>
                        <Input
                          id="member-reset"
                          type="number"
                          min="1"
                          max="12"
                          value={value("memberNumberResetMonth")}
                          onChange={(e) => update("memberNumberResetMonth", Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="member-seq-digits">หลักเลขลำดับ</Label>
                        <Input
                          id="member-seq-digits"
                          type="number"
                          min="1"
                          max="10"
                          value={value("memberNumberSequenceDigits")}
                          onChange={(e) => update("memberNumberSequenceDigits", Number(e.target.value))}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="cutoff" className="mt-4">
                <Card className="py-0">
                  <CardContent className="p-6 space-y-4">
                    <h3 className="font-semibold">รอบตัดยอดประจำวัน</h3>
                    <div className="grid sm:grid-cols-2 gap-[13px]">
                      <div className="space-y-2">
                        <Label htmlFor="cutoff-mode">โหมด</Label>
                        <Select
                          value={value("dailyCutOffMode")}
                          onValueChange={(v) => update("dailyCutOffMode", v)}
                        >
                          <SelectTrigger id="cutoff-mode"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">อัตโนมัติ</SelectItem>
                            <SelectItem value="manual">เจ้าหน้าที่ตัดเอง</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cutoff-time">เวลาตัดยอด</Label>
                        <Input
                          id="cutoff-time"
                          type="time"
                          value={value("dailyCutOffTime") || "00:00"}
                          onChange={(e) => update("dailyCutOffTime", e.target.value)}
                          disabled={value("dailyCutOffMode") !== "auto"}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="alert" className="mt-4">
                <Card className="py-0">
                  <CardContent className="p-6 space-y-3">
                    <h3 className="font-semibold">การแจ้งเตือน</h3>
                    <ToggleRow
                      label="สมาชิกยอดคงเหลือต่ำ"
                      description={`แจ้งเตือนเมื่อยอดคงเหลือต่ำกว่า ${value("lowBalanceThreshold")} บาท`}
                      checked={value("lowBalanceAlert")}
                      onCheckedChange={(c) => update("lowBalanceAlert", c)}
                    />
                    {value("lowBalanceAlert") ? (
                      <div className="ml-2 space-y-1">
                        <Label htmlFor="low-bal-threshold">ขีดแจ้งเตือน (บาท)</Label>
                        <Input
                          id="low-bal-threshold"
                          type="number"
                          step="1"
                          min="0"
                          value={value("lowBalanceThreshold")}
                          onChange={(e) => update("lowBalanceThreshold", Number(e.target.value))}
                          className="max-w-xs"
                        />
                      </div>
                    ) : null}
                    <ToggleRow
                      label="สต็อกต่ำกว่าจุดสั่งซื้อ"
                      description="แจ้งเตือนเมื่อสต็อกสินค้าลดต่ำกว่าจุดสั่งซื้อ"
                      checked={value("lowStockAlert")}
                      onCheckedChange={(c) => update("lowStockAlert", c)}
                    />
                    <ToggleRow
                      label="สินค้าใกล้หมดอายุ"
                      description={`แจ้งเตือนภายใน ${value("expiryAlertDays")} วันก่อนหมดอายุ`}
                      checked={value("expiryAlert")}
                      onCheckedChange={(c) => update("expiryAlert", c)}
                    />
                    {value("expiryAlert") ? (
                      <div className="ml-2 space-y-1">
                        <Label htmlFor="expiry-days">ระยะเตือนล่วงหน้า (วัน)</Label>
                        <Input
                          id="expiry-days"
                          type="number"
                          step="1"
                          min="1"
                          max="365"
                          value={value("expiryAlertDays")}
                          onChange={(e) => update("expiryAlertDays", Number(e.target.value))}
                          className="max-w-xs"
                        />
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          ) : null}

          {section === "store" ? (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                {STORE_TABS.map((t) => (
                  <TabsTrigger key={t.id} value={t.id} className="text-xs">
                    <t.icon className="size-3.5" aria-hidden="true" />
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="brand" className="mt-4">
                <Card className="py-0">
                  <CardContent className="p-6 space-y-4">
                    <h3 className="font-semibold">ชื่อแบรนด์</h3>
                    <div className="grid sm:grid-cols-2 gap-[13px]">
                      <div className="space-y-2">
                        <Label htmlFor="app-name">ชื่อแอป</Label>
                        <Input
                          id="app-name"
                          value={value("appName") || ""}
                          onChange={(e) => update("appName", e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="store-name">ชื่อร้าน</Label>
                        <Input
                          id="store-name"
                          value={value("storeName") || ""}
                          onChange={(e) => update("storeName", e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="help-phone">เบอร์ศูนย์ช่วยเหลือ</Label>
                        <Input
                          id="help-phone"
                          value={value("helpPhone") || ""}
                          onChange={(e) => update("helpPhone", e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>ธีมสี</Label>
                      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                        {THEMES.map((t) => (
                          <button
                            type="button"
                            key={t.id}
                            onClick={() => update("appTheme", t.id)}
                            className={cn(
                              "flex flex-col items-center gap-1 rounded-lg border p-2 transition-colors",
                              value("appTheme") === t.id ? "border-emerald-500 bg-emerald-50" : "border-neutral-200 hover:bg-accent",
                            )}
                          >
                            <span className={cn("size-6 rounded-full", t.color)} aria-hidden="true" />
                            <span className="text-[10px] font-medium">{t.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>สไตล์การแสดงผล</Label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {STYLES.map((s) => (
                          <button
                            type="button"
                            key={s.id}
                            onClick={() => update("appStyle", s.id)}
                            className={cn(
                              "rounded-lg border p-3 text-sm transition-colors",
                              value("appStyle") === s.id ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-neutral-200 hover:bg-accent",
                            )}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="display" className="mt-4">
                <Card className="py-0">
                  <CardContent className="p-6 space-y-4">
                    <h3 className="font-semibold">ขนาดตัวอักษร</h3>
                    <RadioCards
                      value={value("fontScale")}
                      onChange={(v) => update("fontScale", v)}
                      options={[
                        { value: "base", label: "ปกติ", hint: "14px" },
                        { value: "large", label: "ใหญ่", hint: "16px" },
                        { value: "xlarge", label: "ใหญ่พิเศษ", hint: "18px" },
                      ]}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          ) : null}

          {section === "system" ? (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                {SYSTEM_TABS.map((t) => (
                  <TabsTrigger key={t.id} value={t.id} className="text-xs">
                    <t.icon className="size-3.5" aria-hidden="true" />
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="roles" className="mt-4">
                <RolesPanel />
              </TabsContent>
              <TabsContent value="import" className="mt-4">
                <PagePlaceholder title="นำเข้าข้อมูล" icon={Upload} hint="เร็ว ๆ นี้" />
              </TabsContent>
              <TabsContent value="backup" className="mt-4">
                <Card className="py-0">
                  <CardContent className="p-6 space-y-3">
                    <h3 className="font-semibold">สำรองข้อมูลอัตโนมัติ</h3>
                    <ToggleRow
                      label="เปิดสำรองข้อมูลอัตโนมัติ"
                      description={`สำรองทุก ${value("backupIntervalHours")} ชม. · เก็บ ${value("backupKeepCount")} ชุดล่าสุด`}
                      checked={value("backupAutoEnabled")}
                      onCheckedChange={(c) => update("backupAutoEnabled", c)}
                    />
                    {value("backupAutoEnabled") ? (
                      <div className="grid sm:grid-cols-2 gap-[13px]">
                        <div className="space-y-2">
                          <Label htmlFor="backup-interval">รอบการสำรอง (ชม.)</Label>
                          <Input
                            id="backup-interval"
                            type="number"
                            min="1"
                            value={value("backupIntervalHours")}
                            onChange={(e) => update("backupIntervalHours", Number(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="backup-keep">เก็บข้อมูลไว้ (ชุด)</Label>
                          <Input
                            id="backup-keep"
                            type="number"
                            min="1"
                            value={value("backupKeepCount")}
                            onChange={(e) => update("backupKeepCount", Number(e.target.value))}
                          />
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="edition" className="mt-4">
                <PagePlaceholder title="รุ่นระบบ" icon={Settings2} hint="เร็ว ๆ นี้" />
              </TabsContent>
              <TabsContent value="system_update" className="mt-4">
                <SystemUpdateView />
              </TabsContent>
            </Tabs>
          ) : null}

          {section === "dev" ? (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                {DEV_TABS.map((t) => (
                  <TabsTrigger key={t.id} value={t.id} className="text-xs">
                    <t.icon className="size-3.5" aria-hidden="true" />
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="install" className="mt-4">
                <PagePlaceholder title="ติดตั้ง Add-on" icon={PackageSearch} hint="เร็ว ๆ นี้" />
              </TabsContent>
              <TabsContent value="network" className="mt-4">
                <PagePlaceholder title="เครือข่าย" icon={Terminal} hint="เร็ว ๆ นี้" />
              </TabsContent>
            </Tabs>
          ) : null}
        </>
      ) : null}

      {/* keep role referenced for type-only usage */}
      <span className="sr-only">{role}</span>
    </div>
  );
}

function SectionPill({ id, current, onSelect, label }: { id: "sale" | "store" | "system" | "dev"; current: string; onSelect: (s: typeof id) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-medium border transition-colors",
        current === id ? "bg-emerald-600 text-white border-emerald-600" : "bg-card text-muted-foreground border-neutral-200 hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}

function RadioCards<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string; hint?: string }[];
}) {
  return (
    <div className="grid grid-cols-3 gap-[13px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-lg border p-3 text-left transition-colors",
            value === o.value ? "border-emerald-500 bg-emerald-50" : "border-neutral-200 hover:bg-accent",
          )}
        >
          <p className={cn("font-medium text-sm", value === o.value && "text-emerald-700")}>{o.label}</p>
          {o.hint ? <p className="text-xs text-muted-foreground mt-0.5">{o.hint}</p> : null}
        </button>
      ))}
    </div>
  );
}

function ToggleRow({ label, description, checked, onCheckedChange }: { label: string; description?: string; checked: boolean; onCheckedChange: (c: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div>
        <p className="font-medium text-sm">{label}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function RolesPanel() {
  // Read-only permission matrix — editing requires a future PATCH /api/roles route.
  const [selectedRole, setSelectedRole] = React.useState(SYSTEM_ROLES[0]!.name);
  const role = SYSTEM_ROLES.find((r) => r.name === selectedRole) ?? SYSTEM_ROLES[0]!;

  return (
    <Card className="py-0">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold">บทบาทและสิทธิ์การใช้งาน</h3>
            <p className="text-sm text-muted-foreground">
              ตรวจสอบสิทธิ์ของแต่ละบทบาท · การแก้ไขสิทธิ์จะเปิดให้ใช้งานในเร็ว ๆ นี้
            </p>
          </div>
          <Select value={selectedRole} onValueChange={setSelectedRole}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SYSTEM_ROLES.map((r) => (
                <SelectItem key={r.name} value={r.name}>
                  {roleLabel(r.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SYSTEM_ROLES.map((r) => (
            <Badge
              key={r.name}
              variant={r.name === selectedRole ? "default" : "outline"}
              className={cn(
                r.name === selectedRole && "bg-emerald-600 text-white border-emerald-600",
              )}
            >
              {roleLabel(r.name)} · {r.permissions.length} สิทธิ์
            </Badge>
          ))}
        </div>

        <div className="rounded-lg border">
          <div className="px-4 py-2 bg-muted/40 border-b">
            <p className="font-medium">{roleLabel(role.name)}</p>
            <p className="text-xs text-muted-foreground">{role.description}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 p-4">
            {PERMISSION_CATALOG.map((perm) => {
              const granted = role.permissions.includes(perm.key as PermissionKey);
              return (
                <label
                  key={perm.key}
                  className="flex items-start gap-2 py-1 cursor-default"
                  title={perm.description}
                >
                  <Checkbox checked={granted} disabled aria-label={perm.key} />
                  <span className="text-xs">
                    <p className="font-mono font-medium">{perm.key}</p>
                    <p className="text-muted-foreground">{perm.description}</p>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default SettingsPage;
