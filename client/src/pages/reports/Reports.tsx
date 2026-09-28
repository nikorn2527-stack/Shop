/**
 * V2-C3 — Extracted from `client/src/pages/Home.tsx` (lines 210-215 + 377-452 + 454-4058).
 * Pure move/extract — no business-logic changes.
 *
 * Reports view = sales summary (timeline/category/product/items/cashier) +
 * bills history + member transactions + stock balance + member balances +
 * timeline drilldown. Tables, charts, filters, CSV/PDF export.
 *
 * Origin citations:
 *   - ROUND 30 (ข้อ 25): สรุปยอดขายแยกตามชนิดสินค้า / พนักงานขาย + ประวัติธุรกรรมสมาชิก
 *   - ROUND 48: แถวสรุปตามช่วงเวลา พร้อมช่วงวันที่จริงของแถว (date → end) สำหรับกดขยายดูรายการสินค้า
 *   - ROUND 49: เครื่องมือเลือกช่วงเวลาฉบับเรียบง่าย (ปุ่มลัด + กำหนดเอง)
 *   - ROUND 51: ตัวกรองพนักงานขายแบบเจาะจง
 *   - ROUND 61 (user): มุมมอง "แยกตามสินค้า / รายการในบิล / พนักงานขาย" เป็นรายงานขั้นสูง (เวอร์ชันโปร)
 *   - ROUND 77 (user): เลือกประเภทธุรกรรมได้หลายอย่างพร้อมกัน
 *   - ROUND 79 (user): เลือกพนักงานขายได้หลายคนพร้อมกัน
 *   - ROUND 34 (req 23.2): สถานะคำขอลดวงเงิน → ป้ายสี
 *   - UI-9: ปุ่มลัดช่วงเวลาของธุรกรรมสมาชิก
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  FileBarChart,
  FileSpreadsheet,
  FileText,
  Lock,
  PackageSearch,
  Printer,
  ReceiptText,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingBag,
  TrendingDown,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import { type EditionFeatureKey } from "@shared/editions";
import { EditionUpgradeModal, useEditionStatus } from "@/components/EditionUi";
import type { MemberLite, Role } from "../pageData";
import type { MemberTransactionRow, SaleHistoryEntry } from "../../../../server/sqliteStore";
import {
  isAdminRole,
  memberFullName,
  money,
  scanCandidates,
} from "../pageData";
import { SectionHeader, StatusPill } from "../PagePrimitives";
import { ThaiDatePicker } from "@/components/ThaiDatePicker";
import {
  downloadReportPdf,
  printReportDoc,
  type ReportDocConfig,
} from "@/reportDoc";
import {
  ExportPreviewModal,
  type ExportFormat,
  type ExportPreviewState,
} from "@/components/ExportPreviewModal";
import {
  downloadCsvFile,
  downloadXlsxFile,
  exportCount,
  exportNumber,
} from "@/exportUtils";
import { MemberScanPicker } from "@/components/ScanPickers";
import { SlipViewButton } from "@/components/SlipViewModal";
import { ReceiptModal } from "@/components/ReceiptModal";
import { TimelineDrilldown } from "./TimelineDrilldown";
import { trpc } from "@/lib/trpc";
import {
  formatLogDateTime,
  formatShortDay,
  formatThaiDate,
  formatThaiMonthYear,
  getErrorMessage,
  isSameMonth,
  parseBahtFromDetail,
  parseStoreDate,
} from "../viewFormat";

/** Payment method → StatusPill tone for the ประวัติบิล table (Reports view). */
const PAYMENT_PILL_TONE: Record<string, string> = {
  เงินสด: "green",
  "QR / สแกน": "blue",
  หักบัญชีสมาชิก: "purple",
};

const TX_TYPE_LABEL: Record<
  | "purchase"
  | "deposit"
  | "withdrawal"
  | "activation"
  | "refund"
  | "limit_request",
  string
> = {
  purchase: "ใช้จ่าย",
  deposit: "เติมเงิน",
  withdrawal: "ถอนเงิน",
  activation: "เปิดใช้บัตร",
  refund: "คืนบัตรเงินสด",
  limit_request: "ขอลดวงเงิน",
};
const TX_TYPE_TONE: Record<
  | "purchase"
  | "deposit"
  | "withdrawal"
  | "activation"
  | "refund"
  | "limit_request",
  "blue" | "green" | "amber" | "purple" | "red"
> = {
  purchase: "blue",
  deposit: "green",
  withdrawal: "amber",
  activation: "green",
  refund: "red",
  limit_request: "purple",
};

/** ROUND 34 (req 23.2) — สถานะคำขอลดวงเงิน → ป้ายสี (แถว kind "limit" ในตารางธุรกรรม) */
const LIMIT_STATUS_META: Record<
  "pending" | "approved" | "rejected",
  { label: string; tone: string }
> = {
  pending: { label: "รอพิจารณา", tone: "amber" },
  approved: { label: "อนุมัติ", tone: "green" },
  rejected: { label: "ปฏิเสธ", tone: "red" },
};

/** memberTransactions merges limit rows with ids offset by 1,000,000 so they stay
 *  unique next to member_transactions ids — reverse the offset to get the real
 *  limit_requests.id needed by member.decideLimitRequest. */
const LIMIT_ROW_ID_OFFSET = 1_000_000;

/** ROUND 48 — แถวสรุปตามช่วงเวลา พร้อมช่วงวันที่จริงของแถว (date → end) สำหรับกดขยายดูรายการสินค้า */
type TimelineRow = {
  label: string;
  date: string;
  end: string;
  orders: number;
  items: number;
  revenue: number;
  cogs: number;
  profit: number;
};

// ROUND 49 — เครื่องมือเลือกช่วงเวลาฉบับเรียบง่าย: ปุ่มลัดกดครั้งเดียวได้ช่วงที่ตั้งใจ
// "วันนี้/เมื่อวาน" = เลือกวันเดียวโดยไม่ต้องแตะปฏิทิน · "กำหนดเอง" = เลือกวันเดียวหรือช่วง
type ReportRangeMode = "today" | "yesterday" | "7d" | "thisMonth" | "custom";
type ReportGroupBy = "day" | "week" | "month";
const REPORT_RANGE_CHIPS: { value: ReportRangeMode; label: string }[] = [
  { value: "today", label: "วันนี้" },
  { value: "yesterday", label: "เมื่อวาน" },
  { value: "7d", label: "7 วันล่าสุด" },
  { value: "thisMonth", label: "เดือนนี้" },
  { value: "custom", label: "กำหนดเอง" },
];
const REPORT_GROUPBY_CHIPS: { value: ReportGroupBy; label: string }[] = [
  { value: "day", label: "รายวัน" },
  { value: "week", label: "รายสัปดาห์" },
  { value: "month", label: "รายเดือน" },
];

export function Reports({
  focusBill,
  onFocusBillConsumed,
  role,
  userName,
}: {
  focusBill: string | null;
  onFocusBillConsumed: () => void;
  role: Role;
  userName: string;
}) {
  const utils = trpc.useUtils();
  const logsQuery = trpc.logs.list.useQuery({ limit: 1000 });
  // ROUND 61 (user) — เวอร์ชัน: มุมมอง “แยกตามสินค้า / รายการในบิล / พนักงานขาย” เป็นรายงานขั้นสูง (เวอร์ชันโปรขึ้นไป)
  const edition = useEditionStatus();
  const hasAdvancedReports = edition.status?.has("reportsAdvanced") ?? false;
  const [upgradeFeature, setUpgradeFeature] =
    useState<EditionFeatureKey | null>(null);
  // ROUND 49 — ช่วงเวลา (ปุ่มลัด) แยกจากการจัดกลุ่มแถว (รายวัน/สัปดาห์/เดือน) อย่างชัดเจน
  const [rangeMode, setRangeMode] = useState<ReportRangeMode>("7d");
  const [groupBy, setGroupBy] = useState<ReportGroupBy>("day");
  // กำหนดเอง: เว้นวันสิ้นสุดว่าง = วันเดียวกับวันเริ่มต้น (เลือกวันเดียวแบบกดครั้งเดียว)
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  // ROUND 51 — ตัวกรองพนักงานขายแบบเจาะจง: ใช้ร่วมกับทุกมุมมอง ทุกช่วงเวลา
  // ROUND 79 (user) — เลือกได้หลายคนพร้อมกัน (เช่น รวม 2 กะในรายงานเดียว) · [] = ทุกคน
  const [staffFilters, setStaffFilters] = useState<string[]>([]);
  // ROUND 30 — สรุปยอดขายแยกตามชนิดสินค้า / พนักงานขาย + ประวัติธุรกรรมสมาชิก
  const [salesView, setSalesView] = useState<
    "timeline" | "category" | "product" | "items" | "cashier"
  >("timeline");
  // ROUND 48 — แถวช่วงเวลาที่กดขยายอยู่ (ดูรายการสินค้าของช่วงนั้น)
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);
  const [billMember, setBillMember] = useState<MemberLite | null>(null);
  const [txMember, setTxMember] = useState<MemberLite | null>(null);
  // ROUND 77 (user) — เลือกประเภทธุรกรรมได้หลายอย่างพร้อมกัน (เช่น เติมเงิน+ถอนเงิน+คืนบัตร):
  // ชุดว่าง = ทุกประเภท · กดทับตัวที่กดอยู่เพื่อถอนออก · “ทั้งหมด” ล้างชุด
  const [txTypes, setTxTypes] = useState<
    (
      | "purchase"
      | "deposit"
      | "withdrawal"
      | "activation"
      | "refund"
      | "limit_request"
    )[]
  >([]);
  const toggleTxType = (
    value:
      | "purchase"
      | "deposit"
      | "withdrawal"
      | "activation"
      | "refund"
      | "limit_request"
  ) => {
    setTxTypes(current =>
      current.includes(value)
        ? current.filter(type => type !== value)
        : [...current, value]
    );
  };
  const [txFrom, setTxFrom] = useState("");
  const [txTo, setTxTo] = useState("");
  // ROUND 49 — เลือกวันเดียวในแท็บธุรกรรม: กดวันที่ฝั่งเดียว อีกฝั่งเว้นว่าง → วันเดียวกันทันที (ไม่ดึงถึงวันนี้แบบเดิม)
  const pickTxFrom = (iso: string) => {
    setTxFrom(iso);
    if (iso && !txTo) setTxTo(iso);
  };
  const pickTxTo = (iso: string) => {
    setTxTo(iso);
    if (iso && !txFrom) setTxFrom(iso);
  };
  // UI-9 — ปุ่มลัดช่วงเวลาของธุรกรรมสมาชิก (เหมือนแท็บยอดขาย/สต็อก)
  const pickTxRangeChip = (mode: ReportRangeMode) => {
    if (mode === "custom") {
      setTxFrom("");
      setTxTo("");
      return;
    }
    const quick = quickRangeOf(mode);
    if (quick) {
      setTxFrom(quick.from);
      setTxTo(quick.to);
    }
  };
  const txRangeActive = (mode: ReportRangeMode): boolean => {
    if (!txFrom && !txTo) return false;
    if (mode === "custom") {
      return !REPORT_RANGE_CHIPS.some(chip => {
        if (chip.value === "custom") return false;
        const quick = quickRangeOf(chip.value);
        return !!quick && quick.from === txFrom && quick.to === txTo;
      });
    }
    const quick = quickRangeOf(mode);
    return !!quick && quick.from === txFrom && quick.to === txTo;
  };
  // ROUND 65 — ช่องค้นหาของรายงานใหม่: ยอดเงินในบัตร + สินค้าคงคลัง (debounce เหมือนประวัติบิล)
  const [balanceSearch, setBalanceSearch] = useState("");
  const [debouncedBalanceSearch, setDebouncedBalanceSearch] = useState("");
  const [stockSearch, setStockSearch] = useState("");
  const [debouncedStockSearch, setDebouncedStockSearch] = useState("");
  // ROUND 34 (req 23.2) — การพิจารณาคำขอลดวงเงิน: ผู้บริหารกดอนุมัติ/ปฏิเสธที่แถวรอพิจารณา
  const [limitDecision, setLimitDecision] = useState<{
    row: MemberTransactionRow;
    decision: "approve" | "reject";
  } | null>(null);
  const [limitError, setLimitError] = useState("");
  const isoDay = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  // ROUND 49 — ช่วงเวลาของรายงานมาจากแหล่งเดียว: ปุ่มลัด หรือช่องกำหนดเอง
  // (เดิม: เลือกวันเดียวแต่ "ถึง" ยังค้างช่วงเดือน → รายงานดึงทั้งเดือนโดยไม่ตรงกับที่เลือก)
  const quickRangeOf = (
    mode: ReportRangeMode
  ): { from: string; to: string } | null => {
    const now = new Date();
    if (mode === "today") return { from: isoDay(now), to: isoDay(now) };
    if (mode === "yesterday") {
      const y = new Date(Date.now() - 86_400_000);
      return { from: isoDay(y), to: isoDay(y) };
    }
    if (mode === "7d")
      return {
        from: isoDay(new Date(Date.now() - 6 * 86_400_000)),
        to: isoDay(now),
      };
    if (mode === "thisMonth")
      return {
        from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: isoDay(now),
      };
    return null;
  };
  const lastQuickRange = useRef({
    from: isoDay(new Date(Date.now() - 6 * 86_400_000)),
    to: isoDay(new Date()),
  });
  const pickRangeChip = (mode: ReportRangeMode) => {
    if (mode === "custom") {
      setRangeFrom("");
      setRangeTo("");
      setRangeMode("custom");
      return;
    }
    const quick = quickRangeOf(mode);
    if (quick) lastQuickRange.current = quick;
    setRangeMode(mode);
  };
  // กำหนดเองแบบเลือกวันเดียว: กดวันที่ฝั่งเดียว อีกฝั่งเว้นว่าง → วันสิ้นสุด = วันเริ่มต้นทันที
  const pickCustomFrom = (iso: string) => {
    setRangeFrom(iso);
    if (iso && (!rangeTo || rangeTo < iso)) setRangeTo(iso);
  };
  const pickCustomTo = (iso: string) => {
    setRangeTo(iso);
    if (iso && (!rangeFrom || rangeFrom > iso)) setRangeFrom(iso);
  };
  // ช่วงที่ใช้จริง — ปุ่มลัดใช้ค่าของปุ่มนั้น · กำหนดเอง: ฝั่งว่างสะท้อนอีกฝั่ง (วันเดียว) · ว่างทั้งคู่ = ช่วงปุ่มลัดล่าสุด
  const quickActive = rangeMode !== "custom" ? quickRangeOf(rangeMode) : null;
  const customFrom = rangeFrom || rangeTo || lastQuickRange.current.from;
  const customTo = rangeTo || rangeFrom || lastQuickRange.current.to;
  const effectiveFrom =
    quickActive?.from ?? (customFrom <= customTo ? customFrom : customTo);
  const effectiveTo =
    quickActive?.to ?? (customFrom <= customTo ? customTo : customFrom);
  const effectiveDays =
    Math.round(
      (Date.parse(`${effectiveTo}T00:00:00`) -
        Date.parse(`${effectiveFrom}T00:00:00`)) /
        86_400_000
    ) + 1;
  const rangeChipLabel =
    rangeMode !== "custom"
      ? (REPORT_RANGE_CHIPS.find(chip => chip.value === rangeMode)?.label ??
        "7 วันล่าสุด")
      : rangeFrom || rangeTo
        ? rangeFrom === rangeTo || !rangeFrom || !rangeTo
          ? formatThaiDate(effectiveFrom)
          : `${formatShortDay(effectiveFrom)}–${formatShortDay(effectiveTo)}`
        : "ล่าสุด (7 วัน)";
  const rangeLabel =
    effectiveFrom === effectiveTo
      ? formatThaiDate(effectiveFrom)
      : `${formatThaiDate(effectiveFrom)} – ${formatThaiDate(effectiveTo)}`;
  // ROUND 51 — ป้ายกำกับตัวกรองพนักงาน สำหรับสถานะ/การ์ดสรุป/หัวเอกสารส่งออก
  const staffSuffix =
    staffFilters.length > 0
      ? ` · พนักงาน: ${staffFilters.length === 1 ? staffFilters[0] : `${staffFilters.length} คน`}`
      : "";
  // ทุกมุมมอง (ภาพรวม/สินค้า/รายการในบิล/ชนิดสินค้า/พนักงาน) ใช้ช่วงเวลาและพนักงานเดียวกันเสมอ
  const dailyQuery = trpc.reports.daily.useQuery(
    {
      from: effectiveFrom,
      to: effectiveTo,
      cashiers: staffFilters.length > 0 ? staffFilters : undefined,
    },
    { placeholderData: previous => previous }
  );
  // ROUND 27 — รายงานเป็น tab workspace: สรุปยอดขาย / ประวัติบิล / การส่งออก
  const [reportTab, setReportTab] = useState<
    "sales" | "bills" | "transactions" | "stock" | "balances" | "export"
  >("sales");
  // Round 32-21 — แท็บย่อยในส่งออกข้อมูล: ไม่ต้องเลื่อนลงไปให้หัวข้อท้ายหลุดจอ
  const [exportTopic, setExportTopic] = useState<
    "sales" | "bills" | "transactions"
  >("sales");
  // ROUND 51 — รายชื่อพนักงานขายจากบิลจริง (ตัวเลือกในดรอปดาวน์ พร้อมจำนวนบิลให้เทียบว่าใครขายเยอะ)
  const cashiersQuery = trpc.reports.cashiers.useQuery(undefined, {
    enabled: reportTab === "sales",
  });
  const cashierOptions = cashiersQuery.data ?? [];
  // ROUND 79 — กดทับถอนออก / กดเพิ่มเข้า — สไตล์เดียวกับชิปหลายประเภทธุรกรรม (r77)
  const toggleStaffFilter = (name: string) =>
    setStaffFilters(current =>
      current.includes(name)
        ? current.filter(entry => entry !== name)
        : [...current, name]
    );
  const resetReportFilters = () => {
    setRangeMode("7d");
    setRangeFrom("");
    setRangeTo("");
    setGroupBy("day");
    setStaffFilters([]);
    setSalesView("timeline");
    setTxMember(null);
    setTxTypes([]);
    setTxFrom("");
    setTxTo("");
    setBalanceSearch("");
    setStockSearch("");
    setReportTab("sales");
  };
  const membersQuery = trpc.member.list.useQuery();
  const members = membersQuery.data ?? [];
  // Round 32-23 — การ์ดสมาชิก (สมาชิกใหม่/เปิดใช้งาน + ยอดเงินคงเหลือ) แทนการ์ดเติม/ถอน
  // ที่ย้ายไปอยู่ในแท็บประวัติธุรกรรมสมาชิกแล้ว
  const memberActiveCount = members.filter(
    member => member.status === "active"
  ).length;
  const memberNewThisMonth = members.filter(member =>
    isSameMonth(parseStoreDate(member.createdAt), new Date())
  ).length;
  const memberWalletTotal = members.reduce(
    (sum, member) => sum + member.balance,
    0
  );
  const categoryQuery = trpc.reports.byCategory.useQuery(
    {
      from: effectiveFrom,
      to: effectiveTo,
      cashiers: staffFilters.length > 0 ? staffFilters : undefined,
    },
    {
      enabled: reportTab === "sales" && salesView === "category",
      placeholderData: previous => previous,
    }
  );
  const cashierQuery = trpc.reports.byCashier.useQuery(
    {
      from: effectiveFrom,
      to: effectiveTo,
      cashiers: staffFilters.length > 0 ? staffFilters : undefined,
    },
    {
      enabled: reportTab === "sales" && salesView === "cashier",
      placeholderData: previous => previous,
    }
  );
  const productQuery = trpc.reports.byProduct.useQuery(
    {
      from: effectiveFrom,
      to: effectiveTo,
      cashiers: staffFilters.length > 0 ? staffFilters : undefined,
    },
    {
      enabled: reportTab === "sales" && salesView === "product",
      placeholderData: previous => previous,
    }
  );
  // ROUND 48 — มุมมอง "แยกตามรายการในบิล": ทุกบรรทัดสินค้าจากทุกบิลในช่วงเวลา
  const lineItemsQuery = trpc.reports.lineItems.useQuery(
    {
      from: effectiveFrom,
      to: effectiveTo,
      cashiers: staffFilters.length > 0 ? staffFilters : undefined,
    },
    {
      enabled: reportTab === "sales" && salesView === "items",
      placeholderData: previous => previous,
    }
  );
  const txQuery = trpc.reports.memberTransactions.useQuery({
    memberNumber: txMember?.memberNumber,
    types: txTypes.length > 0 ? txTypes : undefined,
    from: txFrom || undefined,
    to: txTo || undefined,
    limit: 300,
  });
  const txRows = txQuery.data ?? [];
  // ROUND 65 — รายงานใหม่: ยอดเงินในบัตรทุกใบ + สินค้าคงคลังตามช่วงเวลา (ยอดยกมา/ยอดขาย/คงเหลือ)
  const balancesQuery = trpc.reports.memberBalances.useQuery(
    { search: debouncedBalanceSearch || undefined },
    { enabled: reportTab === "balances" }
  );
  const balanceRows = balancesQuery.data ?? [];
  const stockBalanceQuery = trpc.reports.stockBalance.useQuery(
    {
      from: effectiveFrom,
      to: effectiveTo,
      search: debouncedStockSearch || undefined,
    },
    { enabled: reportTab === "stock" }
  );
  const stockBalanceRows = stockBalanceQuery.data ?? [];
  const balanceTotals = useMemo(
    () => ({
      members: balanceRows.length,
      active: balanceRows.filter(row => row.status === "active").length,
      totalIn: balanceRows.reduce((sum, row) => sum + row.totalIn, 0),
      totalOut: balanceRows.reduce((sum, row) => sum + row.totalOut, 0),
      balance: balanceRows.reduce((sum, row) => sum + row.balance, 0),
    }),
    [balanceRows]
  );
  const stockTotals = useMemo(
    () => ({
      items: stockBalanceRows.length,
      opening: stockBalanceRows.reduce((sum, row) => sum + row.opening, 0),
      sold: stockBalanceRows.reduce((sum, row) => sum + row.sold, 0),
      remaining: stockBalanceRows.reduce((sum, row) => sum + row.remaining, 0),
    }),
    [stockBalanceRows]
  );
  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedBalanceSearch(balanceSearch.trim()),
      350
    );
    return () => clearTimeout(timer);
  }, [balanceSearch]);
  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedStockSearch(stockSearch.trim()),
      350
    );
    return () => clearTimeout(timer);
  }, [stockSearch]);
  // ROUND 34 (req 23.2) — คำขอลดวงเงินค้างพิจารณา (ข้อมูลน้อย ดึงตลอดเพื่อการ์ดสรุปและ badge)
  const limitRequestsQuery = trpc.reports.limitRequests.useQuery({
    status: "pending",
    limit: 200,
  });
  const pendingLimitCount = limitRequestsQuery.data?.pendingCount ?? 0;
  // ผู้บริหารอนุมัติ/ปฏิเสธคำขอจากแถวรอพิจารณาในตาราง (approve = ตั้งวงเงินเป็นค่าที่ขอ)
  const decideLimitMutation = trpc.member.decideLimitRequest.useMutation({
    onSuccess: result => {
      const name = result.memberName ?? result.memberNumber;
      setLimitDecision(null);
      setLimitError("");
      setNotice(
        result.status === "approved"
          ? `อนุมัติคำขอลดวงเงิน ${name} แล้ว · วงเงินใหม่ ${money(result.requestedLimit)}`
          : `ปฏิเสธคำขอลดวงเงิน ${name} แล้ว · วงเงินคงเดิม ${result.currentLimit != null ? money(result.currentLimit) : "ไม่จำกัด"}`
      );
      void utils.reports.memberTransactions.invalidate();
      void utils.reports.limitRequests.invalidate();
      void utils.member.list.invalidate();
    },
    onError: mutationError => setLimitError(getErrorMessage(mutationError)),
  });
  const confirmLimitDecision = () => {
    if (!limitDecision) return;
    decideLimitMutation.mutate({
      requestId: limitDecision.row.id - LIMIT_ROW_ID_OFFSET,
      decision: limitDecision.decision,
      actor: userName || "ผู้ใช้ระบบ",
      actorRole: role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่",
    });
  };
  const [notice, setNotice] = useState("");
  const [billSearch, setBillSearch] = useState("");
  const [debouncedBillSearch, setDebouncedBillSearch] = useState("");
  // Render caps (round 15): bills history starts collapsed (ยอดขายเห็นครบในกรอบเลื่อนแล้ว).
  const [billsVisible, setBillsVisible] = useState(100);
  const [viewedReceipt, setViewedReceipt] = useState<SaleHistoryEntry | null>(
    null
  );
  const salesHistoryQuery = trpc.sales.list.useQuery(
    billMember
      ? { search: billMember.memberNumber, limit: 200 }
      : debouncedBillSearch
        ? { search: debouncedBillSearch }
        : undefined,
    { placeholderData: previous => previous }
  );
  const salesHistory = salesHistoryQuery.data ?? [];
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setDebouncedBillSearch(
          scanCandidates(billSearch.trim()).pop() ?? billSearch.trim()
        ),
      350
    );
    return () => clearTimeout(timer);
  }, [billSearch]);
  // A new search returns the bills list to its first page.
  useEffect(() => {
    setBillsVisible(100);
  }, [debouncedBillSearch, billMember]);
  // Auto-open the reprint modal for a bill requested from the ⌘K palette.
  // Waits until the list has loaded (50 newest bills), opens the same modal a
  // row click uses, and consumes the request exactly once — silently skips if
  // the bill is not among the loaded rows.
  const consumedBillRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusBill || consumedBillRef.current === focusBill) return;
    if (salesHistoryQuery.isLoading || !salesHistoryQuery.isSuccess) return;
    const match = salesHistory.find(entry => entry.orderNumber === focusBill);
    consumedBillRef.current = focusBill;
    onFocusBillConsumed();
    setReportTab("bills"); // ⌘K ส่งมาที่บิล — สลับไปแท็บประวัติบิลให้อัตโนมัติ
    if (match) setViewedReceipt(match);
  }, [
    focusBill,
    salesHistoryQuery.isLoading,
    salesHistoryQuery.isSuccess,
    salesHistory,
    onFocusBillConsumed,
  ]);
  const dailyRows = dailyQuery.data ?? [];
  const walletTotals = useMemo(() => {
    const totals = {
      deposit: 0,
      depositCount: 0,
      withdraw: 0,
      withdrawCount: 0,
    };
    for (const log of logsQuery.data ?? []) {
      const amount = parseBahtFromDetail(log.detail);
      if (log.action === "เติมเงินสมาชิก") {
        totals.deposit += amount;
        totals.depositCount += 1;
      } else if (log.action === "ถอนเงินสมาชิก") {
        totals.withdraw += amount;
        totals.withdrawCount += 1;
      }
    }
    return totals;
  }, [logsQuery.data]);
  // ROUND 49 — จัดกลุ่มแถว (รายวัน/สัปดาห์/เดือน) บนข้อมูลของ "ช่วงเวลาที่เลือกจริง" เท่านั้น
  // ทุกแถวพกวันที่จริงของตัวเอง (date → end) เพื่อกดขยายดูรายการสินค้าของช่วงนั้น
  const reportRows = useMemo(() => {
    const sum = (list: typeof dailyRows) =>
      list.reduce(
        (acc, row) => ({
          orders: acc.orders + row.orders,
          items: acc.items + row.items,
          revenue: acc.revenue + row.revenue,
          cogs: acc.cogs + row.cogs,
          profit: acc.profit + row.profit,
        }),
        { orders: 0, items: 0, revenue: 0, cogs: 0, profit: 0 }
      );
    if (dailyRows.length === 0) return [] as TimelineRow[];
    if (groupBy === "month") {
      const months: { key: string; rows: typeof dailyRows }[] = [];
      for (const row of dailyRows) {
        const key = row.date.slice(0, 7);
        const last = months[months.length - 1];
        if (last && last.key === key) last.rows.push(row);
        else months.push({ key, rows: [row] });
      }
      return months.map(group => ({
        label: formatThaiMonthYear(group.rows[0].date),
        date: group.rows[0].date,
        end: group.rows[group.rows.length - 1].date,
        ...sum(group.rows),
      }));
    }
    if (groupBy === "week") {
      const weeks: TimelineRow[] = [];
      for (let start = 0; start < dailyRows.length; start += 7) {
        const chunk = dailyRows.slice(start, start + 7);
        weeks.push({
          label: `${formatShortDay(chunk[0].date)}–${formatShortDay(chunk[chunk.length - 1].date)}`,
          date: chunk[0].date,
          end: chunk[chunk.length - 1].date,
          ...sum(chunk),
        });
      }
      return weeks;
    }
    return dailyRows.map(row => ({
      label: formatShortDay(row.date),
      date: row.date,
      end: row.date,
      orders: row.orders,
      items: row.items,
      revenue: row.revenue,
      cogs: row.cogs,
      profit: row.profit,
    }));
  }, [dailyRows, groupBy]);
  const totals = reportRows.reduce(
    (acc, row) => ({
      orders: acc.orders + row.orders,
      items: acc.items + row.items,
      revenue: acc.revenue + row.revenue,
      cogs: acc.cogs + row.cogs,
      profit: acc.profit + row.profit,
    }),
    { orders: 0, items: 0, revenue: 0, cogs: 0, profit: 0 }
  );
  const marginPercent =
    totals.revenue > 0
      ? ((totals.profit / totals.revenue) * 100).toFixed(1)
      : "0.0";
  // ROUND 79 (user) — การ์ดสรุป 4 ใบ: เตี้ยลงแต่ใส่ข้อมูลเพิ่ม (ชิ้น · เฉลี่ยต่อบิล · ต้นทุน · เฉลี่ยต่อบัญชี)
  const avgPerBill =
    totals.orders > 0
      ? Math.round((totals.revenue / totals.orders) * 100) / 100
      : 0;
  const avgWalletPerMember =
    members.length > 0
      ? Math.round((memberWalletTotal / members.length) * 100) / 100
      : 0;
  const maxRevenue = Math.max(...reportRows.map(row => row.revenue), 1);
  // ROUND 30 — ตัวเลขสำหรับมุมมองแยกตามชนิดสินค้า / พนักงานขาย และประวัติธุรกรรม
  const categoryRows = categoryQuery.data ?? [];
  const categoryTotal = categoryRows.reduce(
    (acc, row) => ({
      orders: acc.orders + row.orders,
      qty: acc.qty + row.qty,
      revenue: acc.revenue + row.revenue,
      cogs: acc.cogs + row.cogs,
      profit: acc.profit + row.profit,
    }),
    { orders: 0, qty: 0, revenue: 0, cogs: 0, profit: 0 }
  );
  const productRows = productQuery.data ?? [];
  const productTotal = productRows.reduce(
    (acc, row) => ({
      bills: acc.bills + row.bills,
      qty: acc.qty + row.qty,
      revenue: acc.revenue + row.revenue,
      cogs: acc.cogs + row.cogs,
      profit: acc.profit + row.profit,
    }),
    { bills: 0, qty: 0, revenue: 0, cogs: 0, profit: 0 }
  );
  const cashierRows = cashierQuery.data ?? [];
  const cashierTotal = cashierRows.reduce(
    (acc, row) => ({
      orders: acc.orders + row.orders,
      items: acc.items + row.items,
      memberBills: acc.memberBills + row.memberBills,
      discount: acc.discount + row.discount,
      total: acc.total + row.total,
    }),
    { orders: 0, items: 0, memberBills: 0, discount: 0, total: 0 }
  );
  // ROUND 48 — ข้อมูลมุมมอง "แยกตามรายการในบิล" + ตัวรวมสำหรับสรุปหัวรายงาน
  const lineItemRows = lineItemsQuery.data ?? [];
  const lineItemTotals = useMemo(
    () => ({
      bills: new Set(lineItemRows.map(row => row.orderNumber)).size,
      lines: lineItemRows.length,
      qty: lineItemRows.reduce((sum, row) => sum + row.qty, 0),
      revenue: lineItemRows.reduce((sum, row) => sum + row.amount, 0),
    }),
    [lineItemRows]
  );
  const txTotals = {
    spend: txRows
      .filter(row => row.type === "purchase")
      .reduce((sum, row) => sum + row.amount, 0),
    spendCount: txRows.filter(row => row.type === "purchase").length,
    deposit: txRows
      .filter(row => row.type === "deposit")
      .reduce((sum, row) => sum + row.amount, 0),
    depositCount: txRows.filter(row => row.type === "deposit").length,
    withdraw: txRows
      .filter(row => row.type === "withdrawal")
      .reduce((sum, row) => sum + row.amount, 0),
    withdrawCount: txRows.filter(row => row.type === "withdrawal").length,
    // ROUND 65 — เปิดใช้บัตร (พร้อมเงินเริ่มต้น) + คืนบัตรเงินสด
    activation: txRows
      .filter(row => row.type === "activation")
      .reduce((sum, row) => sum + row.amount, 0),
    activationCount: txRows.filter(row => row.type === "activation").length,
    refund: txRows
      .filter(row => row.type === "refund")
      .reduce((sum, row) => sum + row.amount, 0),
    refundCount: txRows.filter(row => row.type === "refund").length,
    // ROUND 34 — แถวคำขอลดวงเงินตามตัวกรองปัจจุบัน
    limitCount: txRows.filter(row => row.kind === "limit").length,
  };
  const dailySalesRows = [
    [
      "วันที่ / ช่วงเวลา",
      "จำนวนบิล",
      "รายการที่ขาย",
      "ยอดขาย",
      "ต้นทุน",
      "กำไร",
    ],
    ...reportRows.map(row => [
      row.label,
      exportCount(row.orders),
      exportCount(row.items),
      exportNumber(row.revenue),
      exportNumber(row.cogs),
      exportNumber(row.profit),
    ]),
    [
      "รวม",
      exportCount(totals.orders),
      exportCount(totals.items),
      exportNumber(totals.revenue),
      exportNumber(totals.cogs),
      exportNumber(totals.profit),
    ],
  ];
  // ROUND 45 — ชุดข้อมูลส่งออกตามมุมมองที่เลือก (timeline / สินค้า / ชนิดสินค้า / พนักงานขาย)
  // CSV กับ Excel ใช้แถวชุดเดียวกับ PDF (dailySalesDocConfig) เพื่อให้ตัวเลขตรงกันทุกไฟล์
  const dailySalesExportPack = (): {
    rows: string[][];
    fileName: string;
    sheetName: string;
    label: string;
  } => {
    if (salesView === "product") {
      return {
        fileName: "sales-by-product",
        sheetName: "ยอดขายตามสินค้า",
        label: "แยกตามสินค้า",
        rows: [
          [
            "สินค้า (รหัส)",
            "บิล",
            "ชิ้น",
            "ยอดขาย (บาท)",
            "ต้นทุน (บาท)",
            "กำไร (บาท)",
          ],
          ...productRows.map(row => [
            `${row.name}${row.sku ? ` (${row.sku})` : ""}`,
            exportCount(row.bills),
            exportCount(row.qty),
            exportNumber(row.revenue),
            exportNumber(row.cogs),
            exportNumber(row.profit),
          ]),
          [
            "รวมทุกสินค้า",
            exportCount(productTotal.bills),
            exportCount(productTotal.qty),
            exportNumber(productTotal.revenue),
            exportNumber(productTotal.cogs),
            exportNumber(productTotal.profit),
          ],
        ],
      };
    }
    if (salesView === "category") {
      return {
        fileName: "sales-by-category",
        sheetName: "ยอดขายตามชนิดสินค้า",
        label: "แยกตามชนิดสินค้า",
        rows: [
          [
            "ชนิดสินค้า",
            "บิล",
            "ชิ้น",
            "ยอดขาย (บาท)",
            "ต้นทุน (บาท)",
            "กำไร (บาท)",
          ],
          ...categoryRows.map(row => [
            row.category,
            exportCount(row.orders),
            exportCount(row.qty),
            exportNumber(row.revenue),
            exportNumber(row.cogs),
            exportNumber(row.profit),
          ]),
          [
            "รวมทุกชนิดสินค้า",
            exportCount(categoryTotal.orders),
            exportCount(categoryTotal.qty),
            exportNumber(categoryTotal.revenue),
            exportNumber(categoryTotal.cogs),
            exportNumber(categoryTotal.profit),
          ],
        ],
      };
    }
    if (salesView === "cashier") {
      return {
        fileName: "sales-by-cashier",
        sheetName: "ยอดขายตามพนักงานขาย",
        label: "แยกตามพนักงานขาย",
        rows: [
          [
            "พนักงานขาย (ผู้ทำรายการ)",
            "บิล",
            "ชิ้น",
            "บิลสมาชิก",
            "ส่วนลดรวม (บาท)",
            "ยอดขายรวม (บาท)",
          ],
          ...cashierRows.map(row => [
            row.cashier,
            exportCount(row.orders),
            exportCount(row.items),
            exportCount(row.memberBills),
            exportNumber(row.discount),
            exportNumber(row.total),
          ]),
          [
            "รวมทุกพนักงาน",
            exportCount(cashierTotal.orders),
            exportCount(cashierTotal.items),
            exportCount(cashierTotal.memberBills),
            exportNumber(cashierTotal.discount),
            exportNumber(cashierTotal.total),
          ],
        ],
      };
    }
    if (salesView === "items") {
      return {
        fileName: "sales-line-items",
        sheetName: "รายการขายรายบิล",
        label: "แยกตามรายการในบิล",
        rows: [
          [
            "วันที่ · เวลา",
            "เลขที่บิล",
            "รายการสินค้า",
            "ชิ้น",
            "ราคา/ชิ้น (บาท)",
            "ยอดรวม (บาท)",
            "ชำระโดย",
            "พนักงานขาย",
          ],
          ...lineItemRows.map(row => [
            formatLogDateTime(row.createdAt),
            row.orderNumber,
            row.productName,
            exportCount(row.qty),
            exportNumber(row.price),
            exportNumber(row.amount),
            row.paymentMethod,
            row.cashier,
          ]),
          [
            "รวม",
            `${exportCount(lineItemTotals.bills)} บิล`,
            `${exportCount(lineItemTotals.lines)} รายการ`,
            exportCount(lineItemTotals.qty),
            "—",
            exportNumber(lineItemTotals.revenue),
            "—",
            "—",
          ],
        ],
      };
    }
    return {
      fileName: "daily-sales-summary",
      sheetName: "สรุปยอดขาย",
      label: "",
      rows: dailySalesRows,
    };
  };
  // Round 31-10 — PDF คือ "เอกสารรายงาน A4" ที่สร้างจากข้อมูลจริงตามมุมมองที่เลือก
  // (ไม่ใช่การจับภาพหน้าแอปอีกต่อไป)
  const dailySalesDocConfig = (): ReportDocConfig => {
    if (salesView === "timeline") {
      return {
        fileName: "daily-sales-summary.pdf",
        title: "รายงานสรุปยอดขายตามช่วงเวลา",
        periodLabel: `ช่วงข้อมูล ${rangeLabel}${staffSuffix}${salesView === "timeline" ? ` · จัดกลุ่มราย${groupBy === "day" ? "วัน" : groupBy === "week" ? "สัปดาห์" : "เดือน"}` : ""}`,
        meta: [
          ["จำนวนบิล", `${totals.orders.toLocaleString("th-TH")} บิล`],
          ["ยอดขายรวม", money(totals.revenue)],
          ["กำไรขั้นต้น", `${money(totals.profit)} (${marginPercent}%)`],
        ],
        columns: [
          "วันที่ / ช่วงเวลา",
          "บิล",
          "รายการที่ขาย",
          "ยอดขาย (บาท)",
          "ต้นทุน (บาท)",
          "กำไร (บาท)",
        ],
        numericCols: [1, 2, 3, 4, 5],
        rows: reportRows.map(row => [
          row.label,
          exportCount(row.orders),
          exportCount(row.items),
          exportNumber(row.revenue),
          exportNumber(row.cogs),
          exportNumber(row.profit),
        ]),
        totalsRow: [
          "รวมทั้งช่วง",
          exportCount(totals.orders),
          exportCount(totals.items),
          exportNumber(totals.revenue),
          exportNumber(totals.cogs),
          exportNumber(totals.profit),
        ],
        brandName: "ร้านค้าสวัสดิการ",
        footnote:
          "ตัวเลขจากระบบขายหน้าร้าน · รายงานสร้างตามช่วงเวลาที่เลือกไว้",
      };
    }
    if (salesView === "product" || salesView === "category") {
      const rows =
        salesView === "product"
          ? productRows.map(row => [
              `${row.name}${row.sku ? ` (${row.sku})` : ""}`,
              exportCount(row.bills),
              exportCount(row.qty),
              exportNumber(row.revenue),
              exportNumber(row.cogs),
              exportNumber(row.profit),
            ])
          : categoryRows.map(row => [
              row.category,
              exportCount(row.orders),
              exportCount(row.qty),
              exportNumber(row.revenue),
              exportNumber(row.cogs),
              exportNumber(row.profit),
            ]);
      const totalsRow =
        salesView === "product"
          ? [
              "รวมทุกสินค้า",
              exportCount(productTotal.bills),
              exportCount(productTotal.qty),
              exportNumber(productTotal.revenue),
              exportNumber(productTotal.cogs),
              exportNumber(productTotal.profit),
            ]
          : [
              "รวมทุกชนิดสินค้า",
              exportCount(categoryTotal.orders),
              exportCount(categoryTotal.qty),
              exportNumber(categoryTotal.revenue),
              exportNumber(categoryTotal.cogs),
              exportNumber(categoryTotal.profit),
            ];
      return {
        fileName: "daily-sales-summary.pdf",
        title:
          salesView === "product"
            ? "รายงานสรุปยอดขายแยกตามสินค้า"
            : "รายงานสรุปยอดขายแยกตามชนิดสินค้า",
        periodLabel: `ช่วงข้อมูล ${rangeLabel}${staffSuffix}`,
        columns: [
          salesView === "product" ? "สินค้า (รหัส)" : "ชนิดสินค้า",
          "บิล",
          "ชิ้น",
          "ยอดขาย (บาท)",
          "ต้นทุน (บาท)",
          "กำไร (บาท)",
        ],
        numericCols: [1, 2, 3, 4, 5],
        rows,
        totalsRow,
        brandName: "ร้านค้าสวัสดิการ",
        footnote: "เรียงตามยอดขายสูงสุดก่อน · ตัวเลขจากระบบขายหน้าร้าน",
      };
    }
    if (salesView === "items") {
      return {
        fileName: "sales-line-items.pdf",
        title: "รายงานรายการสินค้าที่ขาย (รายบิล)",
        periodLabel: `ช่วงข้อมูล ${rangeLabel}${staffSuffix}`,
        meta: [
          ["จำนวนบิล", `${lineItemTotals.bills.toLocaleString("th-TH")} บิล`],
          [
            "จำนวนรายการ",
            `${lineItemTotals.lines.toLocaleString("th-TH")} รายการ`,
          ],
          ["ยอดขายรวม", money(lineItemTotals.revenue)],
        ],
        columns: [
          "วันที่ · เวลา",
          "เลขที่บิล",
          "รายการสินค้า",
          "ชิ้น",
          "ราคา/ชิ้น (บาท)",
          "ยอดรวม (บาท)",
          "ชำระโดย",
          "พนักงานขาย",
        ],
        numericCols: [3, 4, 5],
        rows: lineItemRows.map(row => [
          formatLogDateTime(row.createdAt),
          row.orderNumber,
          row.productName,
          exportCount(row.qty),
          exportNumber(row.price),
          exportNumber(row.amount),
          row.paymentMethod,
          row.cashier,
        ]),
        totalsRow: [
          "รวม",
          `${exportCount(lineItemTotals.bills)} บิล`,
          `${exportCount(lineItemTotals.lines)} รายการ`,
          exportCount(lineItemTotals.qty),
          "—",
          exportNumber(lineItemTotals.revenue),
          "—",
          "—",
        ],
        brandName: "ร้านค้าสวัสดิการ",
        footnote:
          "ทุกบรรทัดสินค้าจากทุกบิลในช่วงเวลาที่เลือก · เรียงจากล่าสุดขึ้นก่อน · แสดงสูงสุด 1,000 รายการ",
        compact: true, // ตาราง 8 คอลัมน์ — ลดขนาดตามฟอร์มให้อยู่บรรทัดเดียว
      };
    }
    return {
      fileName: "daily-sales-summary.pdf",
      title: "รายงานสรุปยอดขายแยกตามพนักงานขาย",
      periodLabel: `ช่วงข้อมูล ${rangeLabel}${staffSuffix}`,
      columns: [
        "พนักงานขาย (ผู้ทำรายการ)",
        "บิล",
        "ชิ้น",
        "บิลสมาชิก",
        "ส่วนลดรวม (บาท)",
        "ยอดขายรวม (บาท)",
      ],
      numericCols: [1, 2, 3, 4, 5],
      rows: cashierRows.map(row => [
        row.cashier,
        exportCount(row.orders),
        exportCount(row.items),
        exportCount(row.memberBills),
        exportNumber(row.discount),
        exportNumber(row.total),
      ]),
      totalsRow: [
        "รวมทุกพนักงาน",
        exportCount(cashierTotal.orders),
        exportCount(cashierTotal.items),
        exportCount(cashierTotal.memberBills),
        exportNumber(cashierTotal.discount),
        exportNumber(cashierTotal.total),
      ],
      brandName: "ร้านค้าสวัสดิการ",
      footnote: "สรุปจากบิลขายจริง · แยกตามผู้ทำรายการที่หน้าร้าน",
    };
  };
  // ROUND 48 (user) — "ก่อนจะ Export ควรมีพรีวิวดูก่อนได้"
  // ทุกปุ่มส่งออกเปิดโมดัลพรีวิวข้อมูลก่อน แล้วผู้ใช้เลือกรูปแบบที่ต้องการ
  // (CSV / Excel / PDF / พิมพ์) จากในโมดัล — ปุ่มที่กดเข้ามาถูกไฮไลต์ไว้ให้
  const [exportPreview, setExportPreview] = useState<ExportPreviewState | null>(
    null
  );
  const waitBriefly = (ms: number) =>
    new Promise(resolve => setTimeout(resolve, ms));
  const salesRowsLoaded = () =>
    (salesView === "items"
      ? lineItemRows.length
      : salesView === "product"
        ? productRows.length
        : salesView === "category"
          ? categoryRows.length
          : salesView === "cashier"
            ? cashierRows.length
            : reportRows.length) > 0;
  const openSalesExportPreview = async (preferred: ExportFormat) => {
    // เปิดจากแท็บอื่น (เช่น แท็บการส่งออกข้อมูล) → สลับมาแท็บสรุปยอดขายแวบเดียวให้ query ของมุมมองนี้รันก่อน
    if (reportTab !== "sales") {
      setReportTab("sales");
      await waitBriefly(250);
    }
    if (!salesRowsLoaded()) {
      setNotice("ยังไม่มีข้อมูลยอดขายในช่วงนี้");
      return;
    }
    const pack = dailySalesExportPack();
    if (pack.rows.length <= 1) {
      setNotice("ยังไม่มีข้อมูลยอดขายในช่วงนี้");
      return;
    }
    const doc = dailySalesDocConfig();
    setExportPreview({
      kind: "sales",
      title: doc.title,
      periodLabel: doc.periodLabel,
      label: pack.label,
      fileName: pack.fileName,
      sheetName: pack.sheetName,
      rows: pack.rows,
      numericCols: doc.numericCols ?? [],
      preferred,
      doc,
      hasTotalsRow: true,
      downloadNoticeBase: `รายงานยอดขาย${pack.label ? " " + pack.label : ""}`,
      printNotice:
        "สั่งพิมพ์รายงานยอดขายแล้ว — เอกสาร A4 ผ่านเครื่องพิมพ์เริ่มต้น",
    });
  };
  const billsExportRows = () => [
    [
      "เลขที่บิล",
      "วันที่ · เวลา",
      "ลูกค้า",
      "เลขสมาชิก",
      "จำนวนรายการ",
      "ชำระโดย",
      "ยอดรวม (บาท)",
    ],
    ...salesHistory.map(entry => [
      entry.orderNumber,
      formatLogDateTime(entry.createdAt),
      entry.memberName ? `สมาชิก ${entry.memberName}` : "บุคคลทั่วไป",
      entry.memberNumber ?? "—",
      exportCount(entry.items.length),
      entry.paymentMethod,
      exportNumber(entry.total),
    ]),
  ];
  const billExportBase = billMember
    ? `bills-${billMember.memberNumber}`
    : "bills-history";
  const billsDocConfig = (): ReportDocConfig => {
    const total = salesHistory.reduce((sum, entry) => sum + entry.total, 0);
    return {
      fileName: `${billExportBase}.pdf`,
      title: "รายงานประวัติบิลขาย",
      periodLabel: billMember
        ? `แยกรายสมาชิก ${billMember.memberNumber} · สมาชิก${billMember.firstName} ${billMember.lastName}`
        : `บิลล่าสุดที่โหลดไว้ ${salesHistory.length} บิล`,
      meta: [
        ["จำนวนบิล", `${salesHistory.length} บิล`],
        ["ยอดรวมทั้งหมด", money(total)],
      ],
      columns: [
        "เลขที่บิล",
        "วันที่ · เวลา",
        "ลูกค้า",
        "เลขสมาชิก",
        "รายการ",
        "ชำระโดย",
        "ยอดรวม (บาท)",
      ],
      numericCols: [4, 6],
      rows: salesHistory.map(entry => [
        entry.orderNumber,
        formatLogDateTime(entry.createdAt),
        entry.memberName ? `สมาชิก ${entry.memberName}` : "บุคคลทั่วไป",
        entry.memberNumber ?? "—",
        exportCount(entry.items.length),
        entry.paymentMethod,
        exportNumber(entry.total),
      ]),
      totalsRow: [
        "รวม",
        "—",
        "—",
        "—",
        exportCount(
          salesHistory.reduce((sum, entry) => sum + entry.items.length, 0)
        ),
        "—",
        exportNumber(total),
      ],
      brandName: "ร้านค้าสวัสดิการ",
      footnote:
        "กดแถวบนหน้าจอเพื่อเปิดใบเสร็จฉบับเต็มได้ · รายงานนี้สร้างจากบิลที่โหลดไว้ตามตัวกรอง",
      compact: true, // ตาราง 7 คอลัมน์ — ลดขนาดตามฟอร์มให้อยู่บรรทัดเดียว
    };
  };
  const openBillsExportPreview = (preferred: ExportFormat) => {
    if (salesHistory.length === 0) {
      setNotice("ยังไม่มีบิลที่จะส่งออก");
      return;
    }
    const doc = billsDocConfig();
    setExportPreview({
      kind: "bills",
      title: doc.title,
      periodLabel: doc.periodLabel,
      label: "ประวัติบิล",
      fileName: billExportBase,
      sheetName: "ประวัติบิล",
      rows: [...billsExportRows(), ...(doc.totalsRow ? [doc.totalsRow] : [])],
      numericCols: doc.numericCols ?? [],
      preferred,
      doc,
      hasTotalsRow: true,
      downloadNoticeBase: `ประวัติบิล · ${salesHistory.length} บิล${billMember ? ` · สมาชิก ${billMember.memberNumber}` : ""}`,
      printNotice: `สั่งพิมพ์ประวัติบิลแล้ว · ${salesHistory.length} บิล`,
    });
  };
  const txExportRows = () => [
    [
      "วันที่ · เวลา",
      "เลขสมาชิก",
      "ชื่อสมาชิก",
      "ประเภท",
      "รายละเอียด",
      "ยอด (บาท)",
      "คงเหลือ(บาท)",
      "ผู้ทำรายการ",
    ],
    ...txRows.map(row => [
      formatLogDateTime(row.createdAt),
      row.memberNumber,
      row.memberName ?? "—",
      TX_TYPE_LABEL[row.type],
      row.detail,
      exportNumber(row.amount),
      row.balanceAfter !== null ? exportNumber(row.balanceAfter) : "—",
      row.actor ?? "ไม่ระบุ",
    ]),
  ];
  const txExportBase = txMember
    ? `member-transactions-${txMember.memberNumber}`
    : "member-transactions";
  const txDocConfig = (): ReportDocConfig => ({
    fileName: `${txExportBase}.pdf`,
    title: "รายงานประวัติธุรกรรมสมาชิก",
    periodLabel: txMember
      ? `สมาชิก ${txMember.memberNumber} · สมาชิก${txMember.firstName} ${txMember.lastName}`
      : "ทุกสมาชิก · แสดง 300 รายการล่าสุด",
    meta: [
      [
        "ชนิดธุรกรรม",
        txTypes.length === 0
          ? "ทั้งหมด"
          : txTypes.map(type => TX_TYPE_LABEL[type]).join(" + "),
      ],
      [
        "ช่วงวันที่",
        txFrom || txTo
          ? `${txFrom || "ต้นช่วง"} → ${txTo || "ปัจจุบัน"}`
          : "ทั้งหมด",
      ],
      ["จำนวนรายการ", `${txRows.length} รายการ`],
    ],
    columns: [
      "วันที่ · เวลา",
      "เลขสมาชิก",
      "ชื่อสมาชิก",
      "ประเภท",
      "รายละเอียด",
      "ยอด (บาท)",
      "คงเหลือ(บาท)",
      "ผู้ทำรายการ",
    ],
    numericCols: [5, 6],
    rows: txRows.map(row => [
      formatLogDateTime(row.createdAt),
      row.memberNumber,
      row.memberName ?? "—",
      TX_TYPE_LABEL[row.type],
      row.detail,
      exportNumber(row.amount),
      row.balanceAfter !== null ? exportNumber(row.balanceAfter) : "—",
      row.actor ?? "ไม่ระบุ",
    ]),
    // แยกสรุปประเภทเงินออกเป็นกล่อง เพื่อไม่ให้ข้อความยาวถูกบีบอยู่ในคอลัมน์รายละเอียด
    summaryBlocks: [
      [
        "เติมเงิน",
        `+${exportNumber(txTotals.deposit)} · ${exportCount(txTotals.depositCount)} รายการ`,
      ],
      [
        "ถอนเงิน",
        `-${exportNumber(txTotals.withdraw)} · ${exportCount(txTotals.withdrawCount)} รายการ`,
      ],
      [
        "ซื้อสินค้า",
        `-${exportNumber(txTotals.spend)} · ${exportCount(txTotals.spendCount)} รายการ`,
      ],
      [
        "เปิดใช้บัตร",
        `+${exportNumber(txTotals.activation)} · ${exportCount(txTotals.activationCount)} รายการ`,
      ],
      [
        "คืนเงิน",
        `+${exportNumber(txTotals.refund)} · ${exportCount(txTotals.refundCount)} รายการ`,
      ],
      [
        "ยอดสุทธิ",
        exportNumber(txRows.reduce((sum, row) => sum + row.amount, 0)),
      ],
    ],
    totalsRow: [
      `รวมทั้งหมด ${txRows.length} รายการ`,
      "—",
      "—",
      "—",
      "—",
      "—",
      "—",
      "—",
    ],
    brandName: "ร้านค้าสวัสดิการ",
    footnote:
      "ข้อมูลจากบัญชีสมาชิกโดยตรง · แยกสรุปยอดเติมเงิน ถอนเงิน ซื้อสินค้า เปิดใช้บัตร และคืนเงินด้านบน",
    compact: true, // ตาราง 10 คอลัมน์ — ลดขนาดตามฟอร์มให้อยู่บรรทัดเดียว
  });
  const openTxExportPreview = (preferred: ExportFormat) => {
    if (txRows.length === 0) {
      setNotice("ยังไม่มีธุรกรรมที่จะส่งออกตามตัวกรองนี้");
      return;
    }
    const doc = txDocConfig();
    setExportPreview({
      kind: "transactions",
      title: doc.title,
      periodLabel: doc.periodLabel,
      label: "ประวัติธุรกรรม",
      fileName: txExportBase,
      sheetName: "ประวัติธุรกรรม",
      rows: [...txExportRows(), ...(doc.totalsRow ? [doc.totalsRow] : [])],
      numericCols: doc.numericCols ?? [],
      preferred,
      doc,
      hasTotalsRow: true,
      downloadNoticeBase: `ประวัติธุรกรรม · ${txRows.length} รายการ${txMember ? ` · สมาชิก ${txMember.memberNumber}` : ""}`,
      printNotice: `สั่งพิมพ์ประวัติธุรกรรมแล้ว · ${txRows.length} รายการ`,
    });
  };
  // ROUND 65 — ชุดส่งออกของรายงานใหม่ 2 ตัว (ยอดเงินในบัตร + สินค้าคงคลัง)
  const balancesDocConfig = (): ReportDocConfig => ({
    fileName: "member-card-balances.pdf",
    title: "รายงานยอดเงินในบัตรสมาชิก",
    periodLabel: `ณ วันที่สร้างรายงาน ${formatThaiDate(new Date())}${debouncedBalanceSearch ? ` · ค้นหา “${debouncedBalanceSearch}”` : ""}`,
    meta: [
      ["จำนวนสมาชิก", `${balanceTotals.members.toLocaleString("th-TH")} ราย`],
      ["ยอดเงินเข้ารวม", money(balanceTotals.totalIn)],
      ["คงเหลือรวม", money(balanceTotals.balance)],
    ],
    columns: [
      "ลำดับ",
      "เลขสมาชิก",
      "ชื่อ-นามสกุล",
      "วันที่เปิดใช้สมาชิก",
      "ยอดทั้งหมด (บาท)",
      "ยอดจ่าย (บาท)",
      "คงเหลือ (บาท)",
    ],
    numericCols: [4, 5, 6],
    rows: balanceRows.map((row, index) => [
      exportCount(index + 1),
      row.memberNumber,
      memberFullName(row),
      formatThaiDate(row.createdAt),
      exportNumber(row.totalIn),
      exportNumber(row.totalOut),
      exportNumber(row.balance),
    ]),
    totalsRow: [
      "รวม",
      `${balanceTotals.members} ราย`,
      "",
      "",
      exportNumber(balanceTotals.totalIn),
      exportNumber(balanceTotals.totalOut),
      exportNumber(balanceTotals.balance),
    ],
    brandName: "ร้านค้าสวัสดิการ",
    footnote:
      "ยอดทั้งหมด = เปิดใช้บัตร + เติมเงิน · ยอดจ่าย = ใช้ซื้อ + ถอน + คืนบัตรเงินสด · คงเหลือ = ยอดปัจจุบัน",
  });
  const openBalancesExportPreview = (preferred: ExportFormat) => {
    if (balanceRows.length === 0) {
      setNotice("ยังไม่มีข้อมูลสมาชิกที่จะส่งออก");
      return;
    }
    const doc = balancesDocConfig();
    setExportPreview({
      kind: "balances",
      title: doc.title,
      periodLabel: doc.periodLabel,
      label: "ยอดเงินในบัตร",
      fileName: "member-card-balances",
      sheetName: "ยอดเงินในบัตร",
      rows: [
        [
          "ลำดับ",
          "เลขสมาชิก",
          "ชื่อ-นามสกุล",
          "วันที่เปิดใช้สมาชิก",
          "ยอดทั้งหมด (บาท)",
          "ยอดจ่าย (บาท)",
          "คงเหลือ (บาท)",
        ],
        ...balanceRows.map((row, index) => [
          exportCount(index + 1),
          row.memberNumber,
          memberFullName(row),
          formatThaiDate(row.createdAt),
          exportNumber(row.totalIn),
          exportNumber(row.totalOut),
          exportNumber(row.balance),
        ]),
        [
          "รวม",
          `${balanceTotals.members} ราย`,
          "",
          "",
          exportNumber(balanceTotals.totalIn),
          exportNumber(balanceTotals.totalOut),
          exportNumber(balanceTotals.balance),
        ],
      ],
      numericCols: doc.numericCols ?? [],
      preferred,
      doc,
      hasTotalsRow: true,
      downloadNoticeBase: `ยอดเงินในบัตร · ${balanceRows.length} ราย`,
      printNotice: `สั่งพิมพ์รายงานยอดเงินในบัตรแล้ว · ${balanceRows.length} ราย`,
    });
  };
  const stockBalanceDocConfig = (): ReportDocConfig => ({
    fileName: "stock-balance-period.pdf",
    title: "รายงานสินค้าคงคลัง",
    periodLabel: `ช่วงข้อมูล ${rangeLabel} · ยอดยกมา ณ ต้นช่วง${debouncedStockSearch ? ` · ค้นหา “${debouncedStockSearch}”` : ""}`,
    meta: [
      ["จำนวนรายการ", `${stockTotals.items.toLocaleString("th-TH")} รายการ`],
      ["ขายออกในช่วง", `${stockTotals.sold.toLocaleString("th-TH")} ชิ้น`],
      ["คงเหลือรวม", `${stockTotals.remaining.toLocaleString("th-TH")} ชิ้น`],
    ],
    columns: [
      "ลำดับ",
      "รหัสสินค้า",
      "ชื่อสินค้า",
      "หน่วย",
      "ยอดยกมา",
      "ยอดขาย",
      "คงเหลือ",
    ],
    numericCols: [4, 5, 6],
    rows: stockBalanceRows.map((row, index) => [
      exportCount(index + 1),
      row.code,
      row.name,
      row.unit,
      exportCount(row.opening),
      exportCount(row.sold),
      exportCount(row.remaining),
    ]),
    totalsRow: [
      "รวม",
      `${stockTotals.items} รายการ`,
      "",
      "",
      exportCount(stockTotals.opening),
      exportCount(stockTotals.sold),
      exportCount(stockTotals.remaining),
    ],
    brandName: "ร้านค้าสวัสดิการ",
    footnote:
      "ยอดยกมา = จำนวนต้นช่วง · ยอดขาย = ขายออกในช่วงที่เลือก · คงเหลือ = สต็อกปัจจุบัน",
    compact: true, // ตาราง 7 คอลัมน์ — ลดขนาดตามฟอร์มให้อยู่บรรทัดเดียว
  });
  const openStockBalanceExportPreview = (preferred: ExportFormat) => {
    if (stockBalanceRows.length === 0) {
      setNotice("ยังไม่มีรายการคงคลังที่จะส่งออก");
      return;
    }
    const doc = stockBalanceDocConfig();
    setExportPreview({
      kind: "stockBalance",
      title: doc.title,
      periodLabel: doc.periodLabel,
      label: "สินค้าคงคลัง",
      fileName: "stock-balance-period",
      sheetName: "สินค้าคงคลัง",
      rows: [
        [
          "ลำดับ",
          "รหัสสินค้า",
          "ชื่อสินค้า",
          "หน่วย",
          "ยอดยกมา",
          "ยอดขาย",
          "คงเหลือ",
        ],
        ...stockBalanceRows.map((row, index) => [
          exportCount(index + 1),
          row.code,
          row.name,
          row.unit,
          exportCount(row.opening),
          exportCount(row.sold),
          exportCount(row.remaining),
        ]),
        [
          "รวม",
          `${stockTotals.items} รายการ`,
          "",
          "",
          exportCount(stockTotals.opening),
          exportCount(stockTotals.sold),
          exportCount(stockTotals.remaining),
        ],
      ],
      numericCols: doc.numericCols ?? [],
      preferred,
      doc,
      hasTotalsRow: true,
      downloadNoticeBase: `สินค้าคงคลัง · ${stockBalanceRows.length} รายการ · ${rangeLabel}`,
      printNotice: `สั่งพิมพ์รายงานสินค้าคงคลังแล้ว · ${stockBalanceRows.length} รายการ`,
    });
  };
  const runExportPreview = async (format: ExportFormat) => {
    const state = exportPreview;
    if (!state) return;
    try {
      if (format === "csv") {
        downloadCsvFile(state.fileName, state.rows);
        setNotice(`ดาวน์โหลด${state.downloadNoticeBase} CSV แล้ว`);
      } else if (format === "xlsx") {
        downloadXlsxFile(
          state.fileName,
          state.sheetName,
          state.rows,
          state.numericCols
        );
        setNotice(`ดาวน์โหลด${state.downloadNoticeBase} Excel แล้ว`);
      } else if (format === "pdf") {
        await downloadReportPdf(state.doc);
        setNotice(`ดาวน์โหลด${state.downloadNoticeBase} PDF แล้ว`);
      } else {
        printReportDoc(state.doc);
        setNotice(state.printNotice);
      }
    } finally {
      setExportPreview(null);
    }
  };
  return (
    <>
      <div className="report-quick-guide" aria-label="ลำดับการออกรายงาน">
        <div>
          <b>1. เลือกรายงาน</b>
          <span>ยอดขาย · บิล · ธุรกรรม · สมาชิก · สต็อก</span>
        </div>
        <div>
          <b>2. กรองข้อมูล</b>
          <span>ช่วงวันที่ · สมาชิก · พนักงาน · ประเภทธุรกรรม</span>
        </div>
        <div>
          <b>3. ส่งออก</b>
          <span>ดูตัวอย่างก่อนดาวน์โหลด PDF, Excel หรือ CSV</span>
        </div>
        <button
          type="button"
          className="outline-button compact"
          onClick={resetReportFilters}
        >
          <RotateCcw size={14} /> ล้างตัวกรองทั้งหมด
        </button>
      </div>{" "}
      <SectionHeader
        eyebrow="สรุปผลและวิเคราะห์ข้อมูล"
        title="รายงาน"
        description="สลับมุมมองทีละแท็บ — แต่ละแท็บได้พื้นที่เต็มจอ เห็นข้อมูลครบทั้งชุด ไม่ต้องอัดหลายตารางไว้ในหน้าเดียว"
        action={
          <button
            className="outline-button"
            title="สลับไปรายงานยอดขาย · แสดงเฉพาะวันนี้"
            onClick={() => {
              setReportTab("sales");
              pickRangeChip("today");
            }}
          >
            <CalendarDays size={16} /> {formatThaiDate(new Date())}{" "}
            <ChevronDown size={15} />
          </button>
        }
      />
      {(reportTab === "sales" || reportTab === "bills") && (
        <div className="report-cards report-cards-dense">
          <div className="report-card">
            <span>ยอดขายสินค้า</span>
            <strong>
              {dailyQuery.isLoading ? "…" : money(totals.revenue)}
            </strong>
            <div className="report-card-facts">
              <i>{totals.orders.toLocaleString("th-TH")} บิล</i>
              <i>{totals.items.toLocaleString("th-TH")} ชิ้น</i>
              <i>เฉลี่ย {money(avgPerBill)}/บิล</i>
              {staffFilters.length > 0 && (
                <i>พนักงาน {staffFilters.length} คน</i>
              )}
            </div>
          </div>
          <div className="report-card">
            <span>กำไรขั้นต้น (ประมาณ)</span>
            <strong className="green-text">
              {dailyQuery.isLoading ? "…" : money(totals.profit)}
            </strong>
            <div className="report-card-facts">
              <i>ต้นทุน {money(totals.cogs)}</i>
              <i>มาร์จิ้น {marginPercent}%</i>
            </div>
          </div>
          <div className="report-card">
            <span>สมาชิกใหม่ · เปิดใช้งาน</span>
            <strong>
              {membersQuery.isLoading ? "…" : memberNewThisMonth}{" "}
              <em className="card-unit">ราย</em>
            </strong>
            <div className="report-card-facts">
              <i>
                ใช้งาน {memberActiveCount}/{members.length} ราย
              </i>
            </div>
          </div>
          <div className="report-card">
            <span>เงินคงเหลือในบัตรสมาชิก</span>
            <strong>
              {membersQuery.isLoading ? "…" : money(memberWalletTotal)}
            </strong>
            <div className="report-card-facts">
              <i>{members.length} บัญชี</i>
              <i>เฉลี่ย {money(avgWalletPerMember)}/บัญชี</i>
            </div>
          </div>
        </div>
      )}
      <div className="dash-workbench report-workbench">
        <div className="dash-tabbar">
          <button
            type="button"
            className={`dash-tab${reportTab === "sales" ? " active" : ""}`}
            onClick={() => setReportTab("sales")}
          >
            <FileBarChart size={15} /> สรุปยอดขาย
          </button>
          <button
            type="button"
            className={`dash-tab${reportTab === "bills" ? " active" : ""}`}
            onClick={() => setReportTab("bills")}
          >
            <ReceiptText size={15} /> ประวัติบิล
            <i className="tab-badge neutral">{salesHistory.length}</i>
          </button>
          <button
            type="button"
            className={`dash-tab${reportTab === "transactions" ? " active" : ""}`}
            onClick={() => setReportTab("transactions")}
          >
            <Activity size={15} /> ประวัติธุรกรรม
            {txRows.length > 0 && (
              <i className="tab-badge neutral">{txRows.length}</i>
            )}
          </button>
          <button
            type="button"
            className={`dash-tab${reportTab === "stock" ? " active" : ""}`}
            onClick={() => setReportTab("stock")}
          >
            <PackageSearch size={15} /> สินค้าคงคลัง
            {stockBalanceRows.length > 0 && (
              <i className="tab-badge neutral">{stockBalanceRows.length}</i>
            )}
          </button>
          <button
            type="button"
            className={`dash-tab${reportTab === "balances" ? " active" : ""}`}
            onClick={() => setReportTab("balances")}
          >
            <WalletCards size={15} /> ยอดเงินในบัตร
            {balanceRows.length > 0 && (
              <i className="tab-badge neutral">{balanceRows.length}</i>
            )}
          </button>
        </div>
        <div className="dash-tab-body">
          {reportTab === "sales" && (
            <section className="panel" id="daily-sales-report">
              <div className="panel-heading">
                <div>
                  <h2>สรุปยอดขาย</h2>
                  <p>
                    ช่วงข้อมูล {rangeLabel} · เลือกมุมมองรายช่วงเวลา
                    (กดแถวดูรายการสินค้าที่ขาย) หรือแยกตามสินค้า / รายการในบิล /
                    ชนิดสินค้า / พนักงานขาย
                  </p>
                </div>
                <div
                  className="report-export-actions"
                  aria-label="พรีวิวข้อมูลก่อนส่งออกรายงานตามมุมมองที่เลือก"
                >
                  <button
                    className="outline-button compact"
                    onClick={() => void openSalesExportPreview("csv")}
                    title="พรีวิวแล้วส่งออก CSV ตามมุมมองปัจจุบัน"
                  >
                    <Download size={15} /> CSV
                  </button>
                  <button
                    className="outline-button compact"
                    onClick={() => void openSalesExportPreview("xlsx")}
                    title="พรีวิวแล้วส่งออก Excel ตามมุมมองปัจจุบัน"
                  >
                    <FileBarChart size={15} /> Excel
                  </button>
                  <button
                    className="outline-button compact"
                    onClick={() => void openSalesExportPreview("pdf")}
                    title="พรีวิวแล้วส่งออก PDF ตามมุมมองปัจจุบัน"
                  >
                    <FileBarChart size={15} /> PDF
                  </button>
                </div>
              </div>
              <div
                className="report-tabs report-view-pills"
                role="tablist"
                aria-label="มุมมองรายงานยอดขาย"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={salesView === "timeline"}
                  className={salesView === "timeline" ? "active" : ""}
                  onClick={() => setSalesView("timeline")}
                >
                  ภาพรวมตามช่วงเวลา
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={salesView === "product"}
                  className={`${salesView === "product" ? "active" : ""}${hasAdvancedReports ? "" : " edition-locked-tab"}`}
                  onClick={() =>
                    hasAdvancedReports
                      ? setSalesView("product")
                      : setUpgradeFeature("reportsAdvanced")
                  }
                >
                  แยกตามสินค้า{!hasAdvancedReports && <Lock size={11} />}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={salesView === "items"}
                  className={`${salesView === "items" ? "active" : ""}${hasAdvancedReports ? "" : " edition-locked-tab"}`}
                  onClick={() =>
                    hasAdvancedReports
                      ? setSalesView("items")
                      : setUpgradeFeature("reportsAdvanced")
                  }
                >
                  แยกตามรายการในบิล{!hasAdvancedReports && <Lock size={11} />}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={salesView === "category"}
                  className={salesView === "category" ? "active" : ""}
                  onClick={() => setSalesView("category")}
                >
                  แยกตามชนิดสินค้า
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={salesView === "cashier"}
                  className={`${salesView === "cashier" ? "active" : ""}${hasAdvancedReports ? "" : " edition-locked-tab"}`}
                  onClick={() =>
                    hasAdvancedReports
                      ? setSalesView("cashier")
                      : setUpgradeFeature("reportsAdvanced")
                  }
                >
                  แยกตามพนักงานขาย{!hasAdvancedReports && <Lock size={11} />}
                </button>
              </div>
              <div className="report-range-row">
                <div
                  className="report-tabs report-period-pills"
                  role="group"
                  aria-label="เลือกช่วงเวลาของรายงาน"
                >
                  {REPORT_RANGE_CHIPS.map(chip => (
                    <button
                      type="button"
                      key={chip.value}
                      className={rangeMode === chip.value ? "active" : ""}
                      onClick={() => pickRangeChip(chip.value)}
                      title={
                        chip.value === "today" || chip.value === "yesterday"
                          ? "เลือกวันเดียว"
                          : undefined
                      }
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
                <div
                  className="tx-type-pills report-staff-pills"
                  role="group"
                  aria-label="กรองตามพนักงานขาย — กดได้หลายคนพร้อมกัน"
                >
                  <button
                    type="button"
                    className={staffFilters.length === 0 ? "active" : ""}
                    onClick={() => setStaffFilters([])}
                    title="แสดงบิลของพนักงานทุกคน"
                  >
                    {cashierOptions.length > 0
                      ? `ทุกคน (${cashierOptions.reduce((sum, option) => sum + option.bills, 0).toLocaleString("th-TH")} บิล)`
                      : "พนักงานขาย: ทุกคน"}
                  </button>
                  {cashierOptions.map(option => {
                    const selected = staffFilters.includes(option.cashier);
                    return (
                      <button
                        type="button"
                        key={option.cashier}
                        aria-pressed={selected}
                        className={selected ? "active" : ""}
                        onClick={() => toggleStaffFilter(option.cashier)}
                        title={
                          selected
                            ? `กดอีกครั้งเพื่อถอน “${option.cashier}” ออกจากตัวกรอง`
                            : `เพิ่ม “${option.cashier}” เข้าตัวกรอง — เลือกหลายคนพร้อมกันได้ เช่น รวม 2 กะในรายงานเดียว`
                        }
                      >
                        {option.cashier} ·{" "}
                        {option.bills.toLocaleString("th-TH")} บิล
                        {selected && (
                          <i className="pill-check" aria-hidden="true">
                            ✓
                          </i>
                        )}
                      </button>
                    );
                  })}
                </div>
                {salesView === "timeline" && (
                  <div
                    className="report-groupby"
                    role="group"
                    aria-label="จัดกลุ่มแถวรายงาน"
                  >
                    <span>แยกตาม</span>
                    {REPORT_GROUPBY_CHIPS.map(chip => (
                      <button
                        type="button"
                        key={chip.value}
                        className={groupBy === chip.value ? "active" : ""}
                        onClick={() => setGroupBy(chip.value)}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                )}
                {rangeMode === "custom" && (
                  <div
                    className="range-picker report-custom-picker"
                    role="group"
                    aria-label="กำหนดช่วงวันที่"
                  >
                    <span>ช่วงวันที่</span>
                    <ThaiDatePicker
                      value={rangeFrom}
                      onChange={pickCustomFrom}
                      max={rangeTo || undefined}
                      ariaLabel="วันเริ่มต้น — เลือกวันเดียวก็แค่กดวันนี้"
                    />
                    <span className="range-sep" aria-hidden="true">
                      →
                    </span>
                    <ThaiDatePicker
                      value={rangeTo}
                      onChange={pickCustomTo}
                      min={rangeFrom || undefined}
                      ariaLabel="วันสิ้นสุด — เว้นว่างไว้คือวันเดียวกับวันเริ่มต้น"
                    />
                    <span className="range-hint">
                      เลือกวันเดียว: กำหนดวันเริ่มต้นอย่างเดียวก็พอ ·
                      ช่วงหลายวัน: กำหนดวันสิ้นสุดเพิ่ม
                    </span>
                  </div>
                )}
              </div>
              <div className="report-range-status" role="status">
                <CalendarDays size={13} /> แสดงข้อมูล{" "}
                <b>{formatThaiDate(effectiveFrom)}</b>
                {effectiveFrom !== effectiveTo ? (
                  <>
                    {" "}
                    ถึง <b>{formatThaiDate(effectiveTo)}</b>
                  </>
                ) : null}{" "}
                · {effectiveDays.toLocaleString("th-TH")} วัน ·{" "}
                {totals.orders.toLocaleString("th-TH")} บิล
                {staffFilters.length > 0 ? (
                  <>
                    {" "}
                    · พนักงาน{" "}
                    <b>
                      {staffFilters.length === 1
                        ? staffFilters[0]
                        : `${staffFilters.length} คน`}
                    </b>
                  </>
                ) : null}
                {rangeMode === "custom" && !rangeFrom && !rangeTo ? (
                  <span className="range-pending-note">
                    {" "}
                    — ยังไม่ได้เลือกวันที่ ใช้ช่วงปุ่มลัดล่าสุดอยู่
                  </span>
                ) : null}
              </div>
              {salesView === "timeline" && (
                <div className="category-report">
                  {dailyQuery.isLoading ? (
                    <div className="table-loading">
                      <FileBarChart size={22} />
                      <b>กำลังโหลดรายงานยอดขาย</b>
                      <span>ดึงข้อมูล {rangeChipLabel} จากระบบ</span>
                    </div>
                  ) : dailyQuery.isError ? (
                    <div className="table-loading">
                      <FileBarChart size={22} />
                      <b>โหลดรายงานไม่สำเร็จ</b>
                      <span>{getErrorMessage(dailyQuery.error)}</span>
                    </div>
                  ) : reportRows.length === 0 ? (
                    <div className="table-loading">
                      <FileBarChart size={22} />
                      <b>
                        {rangeMode === "custom"
                          ? "ไม่มีข้อมูลในวันที่เลือก"
                          : "ยังไม่มีข้อมูลการขาย"}
                      </b>
                      <span>
                        {rangeMode === "custom"
                          ? "ลองเลือกวันอื่น หรือสลับปุ่มลัดเป็น 7 วันล่าสุด"
                          : "เริ่มขายสินค้าผ่าน POS เพื่อดูรายงาน"}
                      </span>
                    </div>
                  ) : (
                    <table
                      className="report-sales-table"
                      aria-label="สรุปยอดขายรายช่วง"
                    >
                      <thead>
                        <tr>
                          <th>วันที่ / ช่วงเวลา</th>
                          <th className="num">บิล</th>
                          <th className="num">ชิ้น</th>
                          <th className="num">ยอดขาย</th>
                          <th className="num">ต้นทุน</th>
                          <th className="num">กำไร</th>
                          <th className="num">กำไร/ยอดขาย</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportRows.map((row, index) => (
                          <Fragment key={row.label}>
                            <tr
                              className={`timeline-row${expandedPeriod === row.label ? " expanded" : ""}`}
                              aria-expanded={expandedPeriod === row.label}
                              title="กดเพื่อดูรายการสินค้าที่ขายในช่วงนี้"
                              onClick={() =>
                                setExpandedPeriod(
                                  expandedPeriod === row.label
                                    ? null
                                    : row.label
                                )
                              }
                            >
                              <td>
                                <span className="row-label">
                                  <i className="drill-caret" aria-hidden="true">
                                    ▾
                                  </i>
                                  <small className="cell-mono">
                                    {row.label}
                                  </small>
                                </span>
                                <span
                                  className={`sales-bar ${["", "blue", "amber", "purple"][index % 4]}`}
                                  aria-hidden="true"
                                >
                                  <i
                                    style={{
                                      width: `${Math.round((row.revenue / maxRevenue) * 100)}%`,
                                    }}
                                  />
                                </span>
                              </td>
                              <td className="num">
                                {row.orders.toLocaleString("th-TH")}
                              </td>
                              <td className="num">
                                {row.items.toLocaleString("th-TH")}
                              </td>
                              <td className="num">
                                <strong>{money(row.revenue)}</strong>
                              </td>
                              <td className="num">{money(row.cogs)}</td>
                              <td className="num">
                                <span
                                  className={
                                    row.profit >= 0
                                      ? "profit-pos"
                                      : "profit-neg"
                                  }
                                >
                                  {money(row.profit)}
                                </span>
                              </td>
                              <td className="num">
                                {row.revenue > 0
                                  ? `${((row.profit / row.revenue) * 100).toFixed(1)}%`
                                  : "—"}
                              </td>
                            </tr>
                            {expandedPeriod === row.label && (
                              <tr className="timeline-drill-row">
                                <td colSpan={7}>
                                  <TimelineDrilldown
                                    from={row.date}
                                    to={row.end}
                                    cashiers={staffFilters}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>รวมทั้งช่วง · {reportRows.length} แถว</td>
                          <td className="num">
                            {totals.orders.toLocaleString("th-TH")}
                          </td>
                          <td className="num">
                            {totals.items.toLocaleString("th-TH")}
                          </td>
                          <td className="num">{money(totals.revenue)}</td>
                          <td className="num">{money(totals.cogs)}</td>
                          <td className="num">{money(totals.profit)}</td>
                          <td className="num">{marginPercent}%</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              )}
              {salesView === "category" && (
                <div className="category-report report-breakdown">
                  {categoryQuery.isLoading ? (
                    <div className="table-loading">
                      <ShoppingBag size={22} />
                      <b>กำลังรวบรวมยอดขายตามชนิดสินค้า</b>
                      <span>
                        ช่วง {effectiveFrom} → {effectiveTo}
                      </span>
                    </div>
                  ) : categoryQuery.isError ? (
                    <div className="table-loading">
                      <FileBarChart size={22} />
                      <b>โหลดรายงานไม่สำเร็จ</b>
                      <span>{getErrorMessage(categoryQuery.error)}</span>
                    </div>
                  ) : categoryRows.length === 0 ? (
                    <div className="table-loading">
                      <ShoppingBag size={22} />
                      <b>ยังไม่มีข้อมูลการขายในช่วงนี้</b>
                      <span>เริ่มขายสินค้าผ่าน POS เพื่อดูรายงาน</span>
                    </div>
                  ) : (
                    <table
                      className="report-sales-table report-breakdown-table"
                      aria-label="สรุปยอดขายแยกตามชนิดสินค้า"
                    >
                      <thead>
                        <tr>
                          <th>ชนิดสินค้า</th>
                          <th className="num">บิล</th>
                          <th className="num">ชิ้น</th>
                          <th className="num">ยอดขาย</th>
                          <th className="num">ต้นทุน</th>
                          <th className="num">กำไร</th>
                          <th className="num">สัดส่วนยอดขาย</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categoryRows.map((row, index) => {
                          const share =
                            categoryTotal.revenue > 0
                              ? (row.revenue / categoryTotal.revenue) * 100
                              : 0;
                          return (
                            <tr key={row.category}>
                              <td>
                                <span className="row-label">
                                  {row.category}
                                </span>
                                <span
                                  className={`sales-bar ${["", "blue", "amber", "purple"][index % 4]}`}
                                  aria-hidden="true"
                                >
                                  <i
                                    style={{ width: `${Math.round(share)}%` }}
                                  />
                                </span>
                              </td>
                              <td className="num">
                                {row.orders.toLocaleString("th-TH")}
                              </td>
                              <td className="num">
                                {row.qty.toLocaleString("th-TH")}
                              </td>
                              <td className="num">
                                <strong>{money(row.revenue)}</strong>
                              </td>
                              <td className="num">{money(row.cogs)}</td>
                              <td className="num">
                                <span
                                  className={
                                    row.profit >= 0
                                      ? "profit-pos"
                                      : "profit-neg"
                                  }
                                >
                                  {money(row.profit)}
                                </span>
                              </td>
                              <td className="num">
                                {categoryTotal.revenue > 0
                                  ? `${share.toFixed(1)}%`
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>รวมทุกชนิดสินค้า · {categoryRows.length} ชนิด</td>
                          <td className="num">
                            {categoryTotal.orders.toLocaleString("th-TH")}
                          </td>
                          <td className="num">
                            {categoryTotal.qty.toLocaleString("th-TH")}
                          </td>
                          <td className="num">
                            {money(categoryTotal.revenue)}
                          </td>
                          <td className="num">{money(categoryTotal.cogs)}</td>
                          <td className="num">{money(categoryTotal.profit)}</td>
                          <td className="num">
                            {categoryTotal.revenue > 0
                              ? `${((categoryTotal.profit / categoryTotal.revenue) * 100).toFixed(1)}%`
                              : "—"}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              )}
              {salesView === "product" && (
                <div className="category-report report-breakdown">
                  {productQuery.isLoading ? (
                    <div className="table-loading">
                      <ShoppingBag size={22} />
                      <b>กำลังรวบรวมยอดขายแยกตามสินค้ารายชิ้น</b>
                      <span>
                        ช่วง {effectiveFrom} → {effectiveTo}
                      </span>
                    </div>
                  ) : productQuery.isError ? (
                    <div className="table-loading">
                      <FileBarChart size={22} />
                      <b>โหลดรายงานไม่สำเร็จ</b>
                      <span>{getErrorMessage(productQuery.error)}</span>
                    </div>
                  ) : productRows.length === 0 ? (
                    <div className="table-loading">
                      <ShoppingBag size={22} />
                      <b>ยังไม่มีข้อมูลการขายในช่วงนี้</b>
                      <span>เริ่มขายสินค้าผ่าน POS เพื่อดูรายงานรายสินค้า</span>
                    </div>
                  ) : (
                    <table
                      className="report-sales-table report-breakdown-table"
                      aria-label="สรุปยอดขายแยกตามสินค้า"
                    >
                      <thead>
                        <tr>
                          <th>สินค้า</th>
                          <th className="num">บิล</th>
                          <th className="num">ชิ้น</th>
                          <th className="num">ยอดขาย</th>
                          <th className="num">ต้นทุน</th>
                          <th className="num">กำไร</th>
                          <th className="num">สัดส่วนยอดขาย</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productRows.map((row, index) => {
                          const share =
                            productTotal.revenue > 0
                              ? (row.revenue / productTotal.revenue) * 100
                              : 0;
                          return (
                            <tr key={row.productId ?? `special-${index}`}>
                              <td>
                                <span className="row-label">{row.name}</span>
                                <small className="cell-sub cell-mono">
                                  {row.sku ??
                                    row.barcode ??
                                    "รายการพิเศษ · ไม่มีรหัส"}
                                </small>
                                <span
                                  className={`sales-bar ${["", "blue", "amber", "purple"][index % 4]}`}
                                  aria-hidden="true"
                                >
                                  <i
                                    style={{ width: `${Math.round(share)}%` }}
                                  />
                                </span>
                              </td>
                              <td className="num">
                                {row.bills.toLocaleString("th-TH")}
                              </td>
                              <td className="num">
                                {row.qty.toLocaleString("th-TH")}
                              </td>
                              <td className="num">
                                <strong>{money(row.revenue)}</strong>
                              </td>
                              <td className="num">{money(row.cogs)}</td>
                              <td className="num">
                                <span
                                  className={
                                    row.profit >= 0
                                      ? "profit-pos"
                                      : "profit-neg"
                                  }
                                >
                                  {money(row.profit)}
                                </span>
                              </td>
                              <td className="num">
                                {productTotal.revenue > 0
                                  ? `${share.toFixed(1)}%`
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>รวมทุกสินค้า · {productRows.length} รายการ</td>
                          <td className="num">
                            {productTotal.bills.toLocaleString("th-TH")}
                          </td>
                          <td className="num">
                            {productTotal.qty.toLocaleString("th-TH")}
                          </td>
                          <td className="num">{money(productTotal.revenue)}</td>
                          <td className="num">{money(productTotal.cogs)}</td>
                          <td className="num">{money(productTotal.profit)}</td>
                          <td className="num">
                            {productTotal.revenue > 0
                              ? `${((productTotal.profit / productTotal.revenue) * 100).toFixed(1)}%`
                              : "—"}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              )}
              {salesView === "items" && (
                <div className="category-report report-breakdown line-items-report">
                  {lineItemsQuery.isLoading ? (
                    <div className="table-loading">
                      <ShoppingBag size={22} />
                      <b>กำลังรวบรวมรายการสินค้าจากทุกบิล</b>
                      <span>
                        ช่วง {effectiveFrom} → {effectiveTo}
                      </span>
                    </div>
                  ) : lineItemsQuery.isError ? (
                    <div className="table-loading">
                      <FileBarChart size={22} />
                      <b>โหลดรายงานไม่สำเร็จ</b>
                      <span>{getErrorMessage(lineItemsQuery.error)}</span>
                    </div>
                  ) : lineItemRows.length === 0 ? (
                    <div className="table-loading">
                      <ShoppingBag size={22} />
                      <b>ยังไม่มีรายการขายในช่วงนี้</b>
                      <span>เริ่มขายสินค้าผ่าน POS เพื่อดูรายการ</span>
                    </div>
                  ) : (
                    <div className="line-items-wrap">
                      <table
                        className="report-sales-table report-breakdown-table line-items-table"
                        aria-label="รายการสินค้าที่ขายในทุกบิล"
                      >
                        <thead>
                          <tr>
                            <th>วันที่ · เวลา</th>
                            <th>เลขที่บิล</th>
                            <th>รายการสินค้า</th>
                            <th className="num">ชิ้น</th>
                            <th className="num">ราคา/ชิ้น</th>
                            <th className="num">ยอดรวม</th>
                            <th>ชำระโดย</th>
                            <th>พนักงานขาย</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lineItemRows.map((row, index) => (
                            <tr key={`${row.orderNumber}-${index}`}>
                              <td>
                                <small className="cell-mono">
                                  {formatLogDateTime(row.createdAt)}
                                </small>
                              </td>
                              <td>
                                <b className="cell-mono">{row.orderNumber}</b>
                                <small className="cell-sub">
                                  {row.memberNumber
                                    ? `สมาชิก ${row.memberNumber}${row.memberName ? ` · ${row.memberName}` : ""}`
                                    : "บุคคลทั่วไป"}
                                </small>
                              </td>
                              <td>
                                <span className="row-label">
                                  {row.productName}
                                </span>
                                <small className="cell-sub">{row.unit}</small>
                              </td>
                              <td className="num">
                                {row.qty.toLocaleString("th-TH")}
                              </td>
                              <td className="num">{money(row.price)}</td>
                              <td className="num">
                                <strong>{money(row.amount)}</strong>
                              </td>
                              <td>{row.paymentMethod}</td>
                              <td>
                                <small>{row.cashier}</small>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={3}>
                              รวม ·{" "}
                              {lineItemTotals.bills.toLocaleString("th-TH")} บิล
                              · {lineItemTotals.lines.toLocaleString("th-TH")}{" "}
                              รายการ
                            </td>
                            <td className="num">
                              {lineItemTotals.qty.toLocaleString("th-TH")}
                            </td>
                            <td className="num">—</td>
                            <td className="num">
                              {money(lineItemTotals.revenue)}
                            </td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      </table>
                      <small className="line-items-note">
                        แสดงสูงสุด 1,000 รายการล่าสุดในช่วงที่เลือก · กดปุ่ม CSV
                        / Excel / PDF ด้านบนเพื่อพรีวิวและส่งออก
                      </small>
                    </div>
                  )}
                </div>
              )}
              {salesView === "cashier" && (
                <div className="category-report report-breakdown">
                  {cashierQuery.isLoading ? (
                    <div className="table-loading">
                      <UsersRound size={22} />
                      <b>กำลังรวบรวมยอดขายตามพนักงานขาย</b>
                      <span>
                        ช่วง {effectiveFrom} → {effectiveTo}
                      </span>
                    </div>
                  ) : cashierQuery.isError ? (
                    <div className="table-loading">
                      <FileBarChart size={22} />
                      <b>โหลดรายงานไม่สำเร็จ</b>
                      <span>{getErrorMessage(cashierQuery.error)}</span>
                    </div>
                  ) : cashierRows.length === 0 ? (
                    <div className="table-loading">
                      <UsersRound size={22} />
                      <b>ยังไม่มีข้อมูลการขายในช่วงนี้</b>
                      <span>เริ่มขายสินค้าผ่าน POS เพื่อดูรายงาน</span>
                    </div>
                  ) : (
                    <table
                      className="report-sales-table report-breakdown-table"
                      aria-label="สรุปยอดขายแยกตามพนักงานขาย"
                    >
                      <thead>
                        <tr>
                          <th>พนักงานขาย (ผู้ทำรายการ)</th>
                          <th className="num">บิล</th>
                          <th className="num">ชิ้น</th>
                          <th className="num">บิลสมาชิก</th>
                          <th className="num">ส่วนลดรวม</th>
                          <th className="num">ยอดขายรวม</th>
                          <th className="num">สัดส่วนยอดขาย</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cashierRows.map((row, index) => {
                          const share =
                            cashierTotal.total > 0
                              ? (row.total / cashierTotal.total) * 100
                              : 0;
                          return (
                            <tr key={row.cashier}>
                              <td>
                                <span className="row-label">{row.cashier}</span>
                                <span
                                  className={`sales-bar ${["", "blue", "amber", "purple"][index % 4]}`}
                                  aria-hidden="true"
                                >
                                  <i
                                    style={{ width: `${Math.round(share)}%` }}
                                  />
                                </span>
                              </td>
                              <td className="num">
                                {row.orders.toLocaleString("th-TH")}
                              </td>
                              <td className="num">
                                {row.items.toLocaleString("th-TH")}
                              </td>
                              <td className="num">
                                {row.memberBills.toLocaleString("th-TH")}
                              </td>
                              <td className="num">{money(row.discount)}</td>
                              <td className="num">
                                <strong>{money(row.total)}</strong>
                              </td>
                              <td className="num">
                                {cashierTotal.total > 0
                                  ? `${share.toFixed(1)}%`
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>รวมทุกพนักงาน · {cashierRows.length} คน</td>
                          <td className="num">
                            {cashierTotal.orders.toLocaleString("th-TH")}
                          </td>
                          <td className="num">
                            {cashierTotal.items.toLocaleString("th-TH")}
                          </td>
                          <td className="num">
                            {cashierTotal.memberBills.toLocaleString("th-TH")}
                          </td>
                          <td className="num">
                            {money(cashierTotal.discount)}
                          </td>
                          <td className="num">{money(cashierTotal.total)}</td>
                          <td className="num">
                            {cashierTotal.total > 0 ? "100%" : "—"}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              )}
            </section>
          )}
          {reportTab === "bills" && (
            <section className="panel table-panel" id="bills-history-report">
              <div className="table-toolbar">
                <div>
                  <h2>ประวัติบิล</h2>
                  <p>
                    กดแถวเพื่อเปิดใบเสร็จย้อนหลังได้ทันที · แสดง 100
                    บิลล่าสุดก่อน · กด แสดงเพิ่ม เพื่อดูบิลเก่ากว่านี้ ·
                    จำกัดเพื่อความเร็วของหน้า · รวม {salesHistory.length} บิล
                  </p>
                </div>
                <div className="toolbar-actions">
                  <div className="search-field">
                    <Search size={16} />
                    <input
                      value={billSearch}
                      onChange={event => setBillSearch(event.target.value)}
                      placeholder="ค้นหาเลขที่บิล หรือเลขสมาชิก (คีย์/สแกนได้)"
                    />
                  </div>
                  <button
                    className="outline-button compact"
                    onClick={() => openBillsExportPreview("csv")}
                  >
                    <Download size={15} /> CSV
                  </button>
                  <button
                    className="outline-button compact"
                    onClick={() => openBillsExportPreview("xlsx")}
                  >
                    <FileBarChart size={15} /> Excel
                  </button>
                  <button
                    className="outline-button compact"
                    onClick={() => openBillsExportPreview("pdf")}
                  >
                    <FileBarChart size={15} /> PDF
                  </button>
                </div>
              </div>
              <div className="bill-member-filter">
                <MemberScanPicker
                  members={members}
                  selectedNumber={billMember?.memberNumber ?? null}
                  onSelect={member => setBillMember(member)}
                  placeholder="กรองตามสมาชิก — คีย์เลขสมาชิก หรือยิงบาร์โค้ด"
                  inputId="bill-member-filter-input"
                />
              </div>
              <div className="table-filter-summary">
                <span>
                  <Search size={13} />{" "}
                  {billMember ? (
                    <>
                      สมาชิก{" "}
                      <b>
                        {billMember.memberNumber} · สมาชิก{billMember.firstName}{" "}
                        {billMember.lastName}
                      </b>{" "}
                      — แยกรายบิลของสมาชิกรายนี้
                    </>
                  ) : billSearch ? (
                    `ค้นหา “${billSearch}”`
                  ) : (
                    "บิลล่าสุดจากระบบ"
                  )}
                </span>
                <span>
                  แสดง <b>{Math.min(billsVisible, salesHistory.length)}</b> จาก{" "}
                  <b>{salesHistory.length}</b> บิล
                  {billMember &&
                    ` · ยอดรวม ${money(salesHistory.slice(0, billsVisible).reduce((sum, entry) => sum + entry.total, 0))}`}
                </span>
              </div>
              <div className="table-wrap">
                {salesHistoryQuery.isLoading ? (
                  <div className="table-loading">
                    <ReceiptText size={22} />
                    <b>กำลังโหลดประวัติบิล</b>
                    <span>ดึง 50 บิลล่าสุดจากระบบ</span>
                  </div>
                ) : salesHistoryQuery.isError ? (
                  <div className="entity-state error" role="alert">
                    <ShieldCheck size={22} />
                    <b>โหลดประวัติบิลไม่สำเร็จ</b>
                    <span>{getErrorMessage(salesHistoryQuery.error)}</span>
                  </div>
                ) : salesHistory.length === 0 ? (
                  <div className="entity-state">
                    <ReceiptText size={22} />
                    <b>ไม่พบบิลตามเงื่อนไข</b>
                    <span>ลองเปลี่ยนคำค้นหา</span>
                  </div>
                ) : (
                  <table className="bill-history-table" aria-label="ประวัติบิล">
                    <thead>
                      <tr>
                        <th>เลขที่บิล</th>
                        <th>วันที่ · เวลา</th>
                        <th>ลูกค้า</th>
                        <th>รายการ</th>
                        <th>ชำระโดย</th>
                        <th className="hide-sm">พนักงานขาย</th>
                        <th className="num">ยอดรวม</th>
                        <th aria-label="เปิดใบเสร็จ" />
                      </tr>
                    </thead>
                    <tbody>
                      {salesHistory.slice(0, billsVisible).map(entry => {
                        const paymentTone =
                          PAYMENT_PILL_TONE[entry.paymentMethod] ?? "amber";
                        return (
                          <tr
                            className="clickable"
                            key={entry.orderNumber}
                            onClick={() => setViewedReceipt(entry)}
                            title={`ดูใบเสร็จ ${entry.orderNumber}`}
                          >
                            <td>
                              <b className="bill-number">{entry.orderNumber}</b>
                            </td>
                            <td>
                              <small className="cell-mono">
                                {formatLogDateTime(entry.createdAt)}
                              </small>
                            </td>
                            <td>
                              <b>
                                {entry.memberName
                                  ? `สมาชิก ${entry.memberName}`
                                  : "บุคคลทั่วไป"}
                              </b>
                              {entry.memberNumber && (
                                <small className="cell-mono">
                                  {entry.memberNumber}
                                </small>
                              )}
                            </td>
                            <td>
                              <span className="bill-items-cell">
                                {entry.items[0]?.name ?? "—"}
                                {entry.items.length > 1
                                  ? ` +${entry.items.length - 1} รายการ`
                                  : ""}
                              </span>
                            </td>
                            <td>
                              <StatusPill tone={paymentTone}>
                                {entry.paymentMethod}
                              </StatusPill>
                            </td>
                            <td className="hide-sm">
                              <small className="bill-cashier-cell">
                                {entry.cashier ?? "—"}
                              </small>
                            </td>
                            <td className="num">
                              <strong className="bill-total-cell">
                                {money(entry.total)}
                              </strong>
                            </td>
                            <td>
                              <div className="row-actions-cell">
                                {entry.hasSlip && (
                                  <SlipViewButton
                                    kind="sale"
                                    id={entry.id}
                                    title={`บิล ${entry.orderNumber}`}
                                    subtitle={`${entry.paymentMethod} · ${money(entry.total)} · ${formatLogDateTime(entry.createdAt)}`}
                                  />
                                )}
                                <button
                                  type="button"
                                  className="row-open"
                                  onClick={() => setViewedReceipt(entry)}
                                  title={`ดูใบเสร็จ ${entry.orderNumber}`}
                                >
                                  ใบเสร็จ <ArrowRight size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              {!salesHistoryQuery.isLoading &&
                !salesHistoryQuery.isError &&
                (billsVisible < salesHistory.length ? (
                  <button
                    type="button"
                    className="table-show-more"
                    onClick={() => setBillsVisible(current => current + 15)}
                  >
                    <ChevronDown size={15} /> แสดงบิลเพิ่มอีก{" "}
                    <b>{salesHistory.length - billsVisible}</b> บิล
                  </button>
                ) : (
                  salesHistory.length > 15 && (
                    <div className="table-show-more done">
                      แสดงทั้งหมด {salesHistory.length} บิลแล้ว
                    </div>
                  )
                ))}
            </section>
          )}
          {reportTab === "transactions" && (
            <section className="panel table-panel" id="tx-report">
              <div className="table-toolbar">
                <div>
                  <h2>ประวัติธุรกรรมสมาชิก</h2>
                  <p>
                    ใช้จ่าย · เติมเงิน · ถอนเงิน
                    พร้อมเจ้าหน้าที่ทำรายการทุกรายการ · กรองตามสมาชิก ประเภท
                    และช่วงเวลาได้
                  </p>
                </div>
                <div className="toolbar-actions">
                  <div
                    className="tx-date-range"
                    role="group"
                    aria-label="ช่วงวันที่ของธุรกรรม"
                  >
                    <ThaiDatePicker
                      value={txFrom}
                      onChange={pickTxFrom}
                      max={txTo || undefined}
                      ariaLabel="วันเริ่มต้นของธุรกรรม — เลือกวันเดียวก็แค่กดวันนี้"
                    />
                    <span aria-hidden="true">→</span>
                    <ThaiDatePicker
                      value={txTo}
                      onChange={pickTxTo}
                      min={txFrom || undefined}
                      ariaLabel="วันสิ้นสุดของธุรกรรม — เว้นว่างไว้คือวันเดียวกับวันเริ่มต้น"
                    />
                  </div>
                  <button
                    className="outline-button compact"
                    onClick={() => openTxExportPreview("csv")}
                  >
                    <Download size={15} /> CSV
                  </button>
                  <button
                    className="outline-button compact"
                    onClick={() => openTxExportPreview("xlsx")}
                  >
                    <FileBarChart size={15} /> Excel
                  </button>
                  <button
                    className="outline-button compact"
                    onClick={() => openTxExportPreview("pdf")}
                  >
                    <FileBarChart size={15} /> PDF
                  </button>
                </div>
              </div>
              <div className="report-range-row">
                <div
                  className="report-tabs report-period-pills"
                  role="group"
                  aria-label="เลือกช่วงเวลาของธุรกรรมสมาชิก"
                >
                  {REPORT_RANGE_CHIPS.map(chip => (
                    <button
                      type="button"
                      key={`tx-${chip.value}`}
                      className={txRangeActive(chip.value) ? "active" : ""}
                      onClick={() => pickTxRangeChip(chip.value)}
                      title={
                        chip.value === "today" || chip.value === "yesterday"
                          ? "เลือกวันเดียว"
                          : chip.value === "custom"
                            ? "เลือกช่วงวันที่เองด้วยปฏิทิน"
                            : undefined
                      }
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="tx-filter-bar">
                <MemberScanPicker
                  members={members}
                  selectedNumber={txMember?.memberNumber ?? null}
                  onSelect={member => setTxMember(member)}
                  placeholder="กรองตามสมาชิก — คีย์เลขสมาชิก หรือยิงบาร์โค้ด"
                  inputId="tx-member-filter-input"
                />
                <div
                  className="tx-type-pills"
                  role="group"
                  aria-label="กรองตามประเภทธุรกรรม — กดได้หลายประเภทพร้อมกัน"
                >
                  <button
                    type="button"
                    className={txTypes.length === 0 ? "active" : ""}
                    onClick={() => setTxTypes([])}
                    title="แสดงทุกประเภทธุรกรรม"
                  >
                    ทั้งหมด
                  </button>
                  {(
                    [
                      ["purchase", "ใช้จ่าย"],
                      ["deposit", "เติมเงิน"],
                      ["withdrawal", "ถอนเงิน"],
                      ["activation", "เปิดใช้บัตร"],
                      ["refund", "คืนบัตรเงินสด"],
                      ["limit_request", "ขอลดวงเงิน"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={txTypes.includes(value)}
                      className={txTypes.includes(value) ? "active" : ""}
                      onClick={() => toggleTxType(value)}
                      title={
                        txTypes.includes(value)
                          ? `กดอีกครั้งเพื่อถอน “${label}” ออกจากตัวกรอง`
                          : `เพิ่ม “${label}” เข้าตัวกรอง — เลือกหลายประเภทพร้อมกันได้`
                      }
                    >
                      {label}
                      {txTypes.includes(value) && (
                        <i className="pill-check" aria-hidden="true">
                          ✓
                        </i>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="tx-log-strip" role="note">
                <WalletCards size={14} />
                <span>
                  การเงินสมาชิกทั้งระบบ (จาก Log):{" "}
                  <b className="green-text">
                    เติมเงิน {walletTotals.depositCount} รายการ ·{" "}
                    {money(walletTotals.deposit)}
                  </b>{" "}
                  ·{" "}
                  <b className="amber-text">
                    ถอนเงิน {walletTotals.withdrawCount} รายการ ·{" "}
                    {money(walletTotals.withdraw)}
                  </b>
                </span>
              </div>
              <div className="tx-summary-cards six">
                <div>
                  <small>ใช้จ่ายรวม</small>
                  <strong className="red-text">
                    −{money(Math.abs(txTotals.spend))}
                  </strong>
                  <span>{txTotals.spendCount} รายการ</span>
                </div>
                <div>
                  <small>เติมเงินรวม</small>
                  <strong className="green-text">
                    +{money(txTotals.deposit)}
                  </strong>
                  <span>{txTotals.depositCount} รายการ</span>
                </div>
                <div>
                  <small>ถอนเงินรวม</small>
                  <strong className="amber-text">
                    −{money(Math.abs(txTotals.withdraw))}
                  </strong>
                  <span>{txTotals.withdrawCount} รายการ</span>
                </div>
                <div>
                  <small>เปิดใช้บัตรรวม</small>
                  <strong className="green-text">
                    +{money(txTotals.activation)}
                  </strong>
                  <span>{txTotals.activationCount} รายการ</span>
                </div>
                <div>
                  <small>คืนบัตรเงินสดรวม</small>
                  <strong className="red-text">
                    −{money(Math.abs(txTotals.refund))}
                  </strong>
                  <span>{txTotals.refundCount} รายการ</span>
                </div>
                <div>
                  <small>ขอลดวงเงิน</small>
                  <strong className="purple-text">{txTotals.limitCount}</strong>
                  <span>
                    {limitRequestsQuery.isLoading
                      ? "…"
                      : `รอพิจารณา ${pendingLimitCount} รายการ`}
                  </span>
                </div>
              </div>
              <div className="table-wrap">
                {txQuery.isLoading ? (
                  <div className="table-loading">
                    <Activity size={22} />
                    <b>กำลังโหลดประวัติธุรกรรม</b>
                    <span>ดึงข้อมูลจากบัญชีสมาชิกทุกรายการ</span>
                  </div>
                ) : txQuery.isError ? (
                  <div className="entity-state error" role="alert">
                    <Activity size={22} />
                    <b>โหลดประวัติธุรกรรมไม่สำเร็จ</b>
                    <span>{getErrorMessage(txQuery.error)}</span>
                  </div>
                ) : txRows.length === 0 ? (
                  <div className="table-loading">
                    <Activity size={22} />
                    <b>ไม่พบธุรกรรมตามเงื่อนไขที่เลือก</b>
                    <span>ลองเปลี่ยนตัวกรอง หรือขยายช่วงวันที่</span>
                  </div>
                ) : (
                  <table
                    className="entity-table tx-table"
                    aria-label="ประวัติธุรกรรมสมาชิก"
                  >
                    <thead>
                      <tr>
                        <th>วันที่ · เวลา</th>
                        <th>สมาชิก / เลขสมาชิก</th>
                        <th>ประเภท</th>
                        <th className="hide-sm">รายละเอียด</th>
                        <th className="num">ยอดเคลื่อน</th>
                        <th className="num hide-sm">คงเหลือ(บาท)</th>
                        <th className="hide-sm">ผู้ทำรายการ</th>
                        {isAdminRole(role) && <th>พิจารณา</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {txRows.map(row => {
                        const isLimit = row.kind === "limit";
                        const limitStatus =
                          LIMIT_STATUS_META[row.status ?? "pending"];
                        return [
                          <tr
                            key={row.id}
                            className={isLimit ? "tx-limit" : `tx-${row.type}`}
                          >
                            <td>
                              <small
                                className="cell-mono"
                                style={{ marginTop: 0 }}
                              >
                                {formatLogDateTime(row.createdAt)}
                              </small>
                            </td>
                            <td>
                              <span className="cell-strong">
                                {row.memberName ?? "—"}
                              </span>
                              <small className="cell-sub">
                                เลขสมาชิก {row.memberNumber}
                              </small>
                            </td>
                            <td>
                              {isLimit ? (
                                <span className="tx-type-cell">
                                  <StatusPill tone={TX_TYPE_TONE[row.type]}>
                                    {TX_TYPE_LABEL[row.type]}
                                  </StatusPill>
                                  <StatusPill tone={limitStatus.tone}>
                                    {limitStatus.label}
                                  </StatusPill>
                                </span>
                              ) : (
                                <StatusPill tone={TX_TYPE_TONE[row.type]}>
                                  {TX_TYPE_LABEL[row.type]}
                                </StatusPill>
                              )}
                            </td>
                            <td className="num">
                              {isLimit ? (
                                <span className="tx-limit-amount">
                                  {money(row.amount)}
                                  <small>วงเงินใหม่ที่ขอ</small>
                                </span>
                              ) : (
                                <span
                                  className={
                                    row.amount >= 0
                                      ? "profit-pos"
                                      : "profit-neg"
                                  }
                                >
                                  {row.amount >= 0 ? "+" : "−"}
                                  {money(Math.abs(row.amount))}
                                </span>
                              )}
                            </td>
                            <td className="num hide-sm">
                              {row.balanceAfter !== null
                                ? money(row.balanceAfter)
                                : "—"}
                            </td>
                            <td className="hide-sm">
                              <small
                                className="cell-sub"
                                style={{ marginTop: 0 }}
                              >
                                {row.actor ?? "ไม่ระบุ"}
                              </small>
                            </td>
                            {isAdminRole(role) && (
                              <td>
                                {isLimit && row.status === "pending" ? (
                                  <span className="limit-act-row">
                                    <button
                                      type="button"
                                      className="limit-act limit-act-approve"
                                      disabled={decideLimitMutation.isPending}
                                      onClick={() => {
                                        setLimitError("");
                                        setLimitDecision({
                                          row,
                                          decision: "approve",
                                        });
                                      }}
                                    >
                                      <Check size={12} /> อนุมัติ
                                    </button>
                                    <button
                                      type="button"
                                      className="limit-act limit-act-reject"
                                      disabled={decideLimitMutation.isPending}
                                      onClick={() => {
                                        setLimitError("");
                                        setLimitDecision({
                                          row,
                                          decision: "reject",
                                        });
                                      }}
                                    >
                                      <X size={12} /> ปฏิเสธ
                                    </button>
                                  </span>
                                ) : (
                                  <small
                                    className="cell-sub"
                                    style={{ marginTop: 0 }}
                                  >
                                    —
                                  </small>
                                )}
                              </td>
                            )}
                          </tr>,
                          <tr key={`${row.id}-d`} className="tx-detail-row">
                            <td
                              colSpan={isAdminRole(role) ? 8 : 7}
                              className="hide-sm-restore"
                            >
                              <span className="tx-detail">{row.detail}</span>
                            </td>
                          </tr>,
                        ];
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="session-table-note">
                <span>
                  {txMember
                    ? `สมาชิก ${txMember.memberNumber} · แสดง 300 รายการล่าสุด`
                    : `แสดง 300 รายการล่าสุดของทุกสมาชิก`}
                  {txFrom || txTo ? ` · ช่วง ${txFrom || "ต้นช่วง"}` : ""}
                  {txTo ? ` → ${txTo}` : ""}
                </span>
                <span>ข้อมูลจากบัญชีสมาชิกโดยตรง</span>
              </div>
            </section>
          )}
          {reportTab === "stock" && (
            <section className="panel" id="stock-balance-report">
              <div className="panel-heading">
                <div>
                  <h2>สินค้าคงคลัง</h2>
                  <p>
                    ตามชีทรายงานโรงพยาบาล — รหัสสินค้า · ยอดยกมา · ยอดขาย ·
                    คงเหลือ · ช่วงข้อมูล {rangeLabel}{" "}
                    (ยอดยกมาคำนวณจากสต็อกปัจจุบันบวกที่ขายออกในช่วง)
                  </p>
                </div>
                <div
                  className="report-export-actions"
                  aria-label="พรีวิวข้อมูลก่อนส่งออกรายงานสินค้าคงคลัง"
                >
                  <button
                    className="outline-button compact"
                    onClick={() => void openStockBalanceExportPreview("csv")}
                    title="พรีวิวแล้วส่งออก CSV"
                  >
                    <Download size={15} /> CSV
                  </button>
                  <button
                    className="outline-button compact"
                    onClick={() => void openStockBalanceExportPreview("xlsx")}
                    title="พรีวิวแล้วส่งออก Excel"
                  >
                    <FileSpreadsheet size={15} /> Excel
                  </button>
                  <button
                    className="outline-button compact"
                    onClick={() => void openStockBalanceExportPreview("pdf")}
                    title="พรีวิวแล้วดาวน์โหลด PDF แบบเอกสาร A4"
                  >
                    <FileText size={15} /> PDF
                  </button>
                  <button
                    className="outline-button compact"
                    onClick={() => void openStockBalanceExportPreview("print")}
                    title="พรีวิวก่อนสั่งพิมพ์"
                  >
                    <Printer size={15} /> พิมพ์
                  </button>
                </div>
              </div>
              <div className="report-range-row">
                <div
                  className="report-tabs report-period-pills"
                  role="group"
                  aria-label="เลือกช่วงเวลาของรายงานสินค้าคงคลัง"
                >
                  {REPORT_RANGE_CHIPS.map(chip => (
                    <button
                      type="button"
                      key={`stock-${chip.value}`}
                      className={rangeMode === chip.value ? "active" : ""}
                      onClick={() => pickRangeChip(chip.value)}
                      title={
                        chip.value === "today" || chip.value === "yesterday"
                          ? "เลือกวันเดียว"
                          : undefined
                      }
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
                {rangeMode === "custom" && (
                  <div className="report-custom-range">
                    <ThaiDatePicker
                      value={rangeFrom}
                      onChange={pickCustomFrom}
                      max={rangeTo || undefined}
                      ariaLabel="วันเริ่มต้นของรายงานสินค้าคงคลัง"
                    />
                    <span className="range-sep" aria-hidden="true">
                      →
                    </span>
                    <ThaiDatePicker
                      value={rangeTo}
                      onChange={pickCustomTo}
                      min={rangeFrom || undefined}
                      ariaLabel="วันสิ้นสุดของรายงานสินค้าคงคลัง — เว้นว่างไว้คือวันเดียวกับวันเริ่มต้น"
                    />
                  </div>
                )}
              </div>
              <div className="tx-summary-cards">
                <div>
                  <small>รายการทั้งหมด</small>
                  <strong>
                    {stockBalanceQuery.isLoading ? (
                      "…"
                    ) : (
                      <>
                        {stockTotals.items.toLocaleString("th-TH")}{" "}
                        <em className="card-unit">รายการ</em>
                      </>
                    )}
                  </strong>
                  <span>ทุกสินค้าในระบบ</span>
                </div>
                <div>
                  <small>ยอดยกมารวม</small>
                  <strong>
                    {stockBalanceQuery.isLoading ? (
                      "…"
                    ) : (
                      <>
                        {stockTotals.opening.toLocaleString("th-TH")}{" "}
                        <em className="card-unit">ชิ้น</em>
                      </>
                    )}
                  </strong>
                  <span>ต้นช่วง {rangeLabel}</span>
                </div>
                <div>
                  <small>ขายออกในช่วง</small>
                  <strong className="red-text">
                    {stockBalanceQuery.isLoading ? (
                      "…"
                    ) : (
                      <>
                        {stockTotals.sold.toLocaleString("th-TH")}{" "}
                        <em className="card-unit">ชิ้น</em>
                      </>
                    )}
                  </strong>
                  <span>{rangeLabel}</span>
                </div>
                <div>
                  <small>คงเหลือรวม</small>
                  <strong className="green-text">
                    {stockBalanceQuery.isLoading ? (
                      "…"
                    ) : (
                      <>
                        {stockTotals.remaining.toLocaleString("th-TH")}{" "}
                        <em className="card-unit">ชิ้น</em>
                      </>
                    )}
                  </strong>
                  <span>สต็อกปัจจุบัน</span>
                </div>
              </div>
              <div className="table-toolbar">
                <div>
                  <h3>รายการสินค้าคงคลัง</h3>
                  <p>
                    {stockBalanceQuery.isLoading
                      ? "กำลังโหลด…"
                      : `${stockBalanceRows.length} รายการ${stockTotals.sold > 0 ? ` · ขายออกไปแล้ว ${stockTotals.sold.toLocaleString("th-TH")} ชิ้นในช่วงนี้` : ""}`}
                  </p>
                </div>
                <div className="toolbar-actions">
                  <div className="search-field">
                    <Search size={16} />
                    <input
                      value={stockSearch}
                      onChange={event => setStockSearch(event.target.value)}
                      placeholder="ค้นหาชื่อสินค้า / รหัส / บาร์โค้ด"
                      aria-label="ค้นหารายการสินค้าคงคลัง"
                    />
                  </div>
                </div>
              </div>
              <div className="table-wrap">
                {stockBalanceQuery.isLoading ? (
                  <div className="table-loading">
                    <PackageSearch size={22} />
                    <b>กำลังโหลดรายงานสินค้าคงคลัง</b>
                    <span>คำนวณยอดยกมา · ยอดขาย · คงเหลือ ตามช่วงเวลา</span>
                  </div>
                ) : stockBalanceQuery.isError ? (
                  <div className="entity-state error" role="alert">
                    <PackageSearch size={22} />
                    <b>โหลดรายงานสินค้าคงคลังไม่สำเร็จ</b>
                    <span>{getErrorMessage(stockBalanceQuery.error)}</span>
                  </div>
                ) : stockBalanceRows.length === 0 ? (
                  <div className="table-loading">
                    <PackageSearch size={22} />
                    <b>ไม่พบรายการสินค้าตามเงื่อนไข</b>
                    <span>ลองเปลี่ยนคำค้นหา</span>
                  </div>
                ) : (
                  <table
                    className="entity-table stock-balance-table"
                    aria-label="รายงานสินค้าคงคลัง"
                  >
                    <thead>
                      <tr>
                        <th className="hide-sm">ลำดับ</th>
                        <th>รหัสสินค้า</th>
                        <th>ชื่อสินค้า</th>
                        <th className="hide-sm">หน่วย</th>
                        <th className="num">ยอดยกมา</th>
                        <th className="num">ยอดขาย</th>
                        <th className="num">คงเหลือ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockBalanceRows.map((row, index) => (
                        <tr key={row.productId}>
                          <td className="hide-sm cell-mono">
                            {exportCount(index + 1)}
                          </td>
                          <td>
                            <small
                              className="cell-mono"
                              style={{ marginTop: 0 }}
                            >
                              {row.code}
                            </small>
                          </td>
                          <td>
                            <span className="cell-strong">{row.name}</span>
                            <small className="cell-sub">
                              {row.category}
                              {row.active === 0 ? " · ปิดการขาย" : ""}
                            </small>
                          </td>
                          <td className="hide-sm">
                            <small
                              className="cell-sub"
                              style={{ marginTop: 0 }}
                            >
                              {row.unit}
                            </small>
                          </td>
                          <td className="num cell-mono">
                            {exportCount(row.opening)}
                          </td>
                          <td className="num cell-mono">
                            {row.sold > 0 ? (
                              <span className="red-text">
                                {exportCount(row.sold)}
                              </span>
                            ) : (
                              exportCount(row.sold)
                            )}
                          </td>
                          <td className="num cell-mono">
                            <strong
                              className={
                                row.remaining <= 0
                                  ? "red-text"
                                  : row.sold > 0
                                    ? "green-text"
                                    : undefined
                              }
                            >
                              {exportCount(row.remaining)}
                            </strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="session-table-note">
                <span>
                  ยอดยกมา = จำนวนต้นช่วง · ยอดขาย = ขายออกในช่วงที่เลือก ·
                  คงเหลือ = สต็อกปัจจุบัน
                </span>
                <span>เปลี่ยนช่วงเวลาได้ที่ปุ่มลัดด้านบนของหน้ารายงาน</span>
              </div>
            </section>
          )}
          {reportTab === "balances" && (
            <section className="panel" id="member-balances-report">
              <div className="panel-heading">
                <div>
                  <h2>ยอดเงินในบัตรสมาชิก</h2>
                  <p>
                    สรุปยอดสมาชิก — เลขสมาชิก · ยอดทั้งหมด (เปิดใช้ + เติมเงิน)
                    · ยอดจ่าย (ใช้ซื้อ + ถอน + คืนบัตร) · คงเหลือ ·
                    วันที่เปิดใช้สมาชิก
                  </p>
                </div>
                <div
                  className="report-export-actions"
                  aria-label="พรีวิวข้อมูลก่อนส่งออกรายงานยอดเงินในบัตร"
                >
                  <button
                    className="outline-button compact"
                    onClick={() => void openBalancesExportPreview("csv")}
                    title="พรีวิวแล้วส่งออก CSV"
                  >
                    <Download size={15} /> CSV
                  </button>
                  <button
                    className="outline-button compact"
                    onClick={() => void openBalancesExportPreview("xlsx")}
                    title="พรีวิวแล้วส่งออก Excel"
                  >
                    <FileSpreadsheet size={15} /> Excel
                  </button>
                  <button
                    className="outline-button compact"
                    onClick={() => void openBalancesExportPreview("pdf")}
                    title="พรีวิวแล้วดาวน์โหลด PDF แบบเอกสาร A4"
                  >
                    <FileText size={15} /> PDF
                  </button>
                  <button
                    className="outline-button compact"
                    onClick={() => void openBalancesExportPreview("print")}
                    title="พรีวิวก่อนสั่งพิมพ์"
                  >
                    <Printer size={15} /> พิมพ์
                  </button>
                </div>
              </div>
              <div className="tx-summary-cards">
                <div>
                  <small>สมาชิกทั้งหมด</small>
                  <strong>
                    {balancesQuery.isLoading ? (
                      "…"
                    ) : (
                      <>
                        {balanceTotals.members.toLocaleString("th-TH")}{" "}
                        <em className="card-unit">ราย</em>
                      </>
                    )}
                  </strong>
                  <span>
                    ใช้งาน {balanceTotals.active} · ระงับ{" "}
                    {balanceTotals.members - balanceTotals.active}
                  </span>
                </div>
                <div>
                  <small>ยอดเงินเข้ารวม</small>
                  <strong className="green-text">
                    {balancesQuery.isLoading
                      ? "…"
                      : `+${money(balanceTotals.totalIn)}`}
                  </strong>
                  <span>เปิดใช้บัตร + เติมเงิน ทุกใบ</span>
                </div>
                <div>
                  <small>ยอดจ่ายรวม</small>
                  <strong className="red-text">
                    {balancesQuery.isLoading
                      ? "…"
                      : `−${money(balanceTotals.totalOut)}`}
                  </strong>
                  <span>ใช้ซื้อ + ถอน + คืนบัตรเงินสด</span>
                </div>
                <div>
                  <small>คงเหลือรวม</small>
                  <strong>
                    {balancesQuery.isLoading
                      ? "…"
                      : money(balanceTotals.balance)}
                  </strong>
                  <span>ยอดเงินในบัตรทุกใบขณะนี้</span>
                </div>
              </div>
              <div className="table-toolbar">
                <div>
                  <h3>บัตรทุกใบในระบบ</h3>
                  <p>
                    {balancesQuery.isLoading
                      ? "กำลังโหลด…"
                      : `${balanceRows.length} ราย · ค้นหาจากชื่อหรือเลขสมาชิก`}
                  </p>
                </div>
                <div className="toolbar-actions">
                  <div className="search-field">
                    <Search size={16} />
                    <input
                      value={balanceSearch}
                      onChange={event => setBalanceSearch(event.target.value)}
                      placeholder="ค้นหาชื่อ / เลขสมาชิก"
                      aria-label="ค้นหารายงานยอดเงินในบัตร"
                    />
                  </div>
                </div>
              </div>
              <div className="table-wrap">
                {balancesQuery.isLoading ? (
                  <div className="table-loading">
                    <WalletCards size={22} />
                    <b>กำลังโหลดยอดเงินในบัตร</b>
                    <span>สรุปยอดทั้งหมด · ยอดจ่าย · คงเหลือ ของบัตรทุกใบ</span>
                  </div>
                ) : balancesQuery.isError ? (
                  <div className="entity-state error" role="alert">
                    <WalletCards size={22} />
                    <b>โหลดรายงานยอดเงินในบัตรไม่สำเร็จ</b>
                    <span>{getErrorMessage(balancesQuery.error)}</span>
                  </div>
                ) : balanceRows.length === 0 ? (
                  <div className="table-loading">
                    <WalletCards size={22} />
                    <b>ไม่พบสมาชิกตามเงื่อนไข</b>
                    <span>ลองเปลี่ยนคำค้นหา</span>
                  </div>
                ) : (
                  <table
                    className="entity-table balances-table"
                    aria-label="รายงานยอดเงินในบัตรสมาชิก"
                  >
                    <thead>
                      <tr>
                        <th className="hide-sm">ลำดับ</th>
                        <th>เลขสมาชิก</th>
                        <th>ชื่อ-นามสกุล</th>
                        <th className="hide-sm">วันที่เปิดใช้สมาชิก</th>
                        <th className="num hide-sm">ยอดทั้งหมด</th>
                        <th className="num">ยอดจ่าย</th>
                        <th className="num">คงเหลือ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {balanceRows.map((row, index) => (
                        <tr
                          key={row.memberNumber}
                          className={
                            row.status === "suspended" ? "row-muted" : undefined
                          }
                        >
                          <td className="hide-sm cell-mono">
                            {exportCount(index + 1)}
                          </td>
                          <td>
                            <small
                              className="cell-mono"
                              style={{ marginTop: 0 }}
                            >
                              {row.memberNumber}
                            </small>
                          </td>
                          <td>
                            <span className="cell-strong">
                              {memberFullName(row)}
                            </span>
                            <small className="cell-sub">
                              {row.type}
                              {row.status === "suspended" ? " · ระงับ" : ""}
                            </small>
                          </td>
                          <td className="hide-sm">
                            <small
                              className="cell-sub"
                              style={{ marginTop: 0 }}
                            >
                              {formatThaiDate(row.createdAt)}
                            </small>
                          </td>
                          <td className="num cell-mono hide-sm">
                            {money(row.totalIn)}
                          </td>
                          <td className="num cell-mono">
                            {money(row.totalOut)}
                          </td>
                          <td className="num cell-mono">
                            <strong
                              className={
                                row.balance <= 0 ? "red-text" : "green-text"
                              }
                            >
                              {money(row.balance)}
                            </strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="session-table-note">
                <span>
                  ยอดทั้งหมด = เปิดใช้บัตร + เติมเงิน · ยอดจ่าย = ใช้ซื้อ + ถอน
                  + คืนบัตรเงินสด
                </span>
                <span>คงเหลือต้องเท่ากับ ยอดทั้งหมด − ยอดจ่าย เสมอ</span>
              </div>
            </section>
          )}
        </div>
      </div>
      {limitDecision && (
        <div className="modal-backdrop" onClick={() => setLimitDecision(null)}>
          <div
            className="confirm-modal limit-decide-modal"
            role="dialog"
            aria-modal="true"
            aria-label="ยืนยันการพิจารณาคำขอลดวงเงิน"
            onClick={event => event.stopPropagation()}
          >
            <div className="confirm-icon">
              <TrendingDown size={21} />
            </div>
            <div className="modal-heading">
              <div>
                <h2>
                  {limitDecision.decision === "approve"
                    ? "ยืนยันการอนุมัติคำขอลดวงเงิน?"
                    : "ยืนยันการปฏิเสธคำขอลดวงเงิน?"}
                </h2>
                <p>ผู้พิจารณา: {userName || "ผู้ใช้ระบบ"} · ผู้บริหาร</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setLimitDecision(null)}
                aria-label="ปิดหน้าต่าง"
              >
                <X size={17} />
              </button>
            </div>
            <div className="wallet-confirm-rows">
              <div>
                <span>สมาชิก</span>
                <b>
                  {limitDecision.row.memberName ?? "—"} ·{" "}
                  {limitDecision.row.memberNumber}
                </b>
              </div>
              <div>
                <span>วงเงินปัจจุบัน</span>
                <b>
                  {limitDecision.row.currentLimit != null
                    ? money(limitDecision.row.currentLimit)
                    : "ไม่จำกัด"}
                </b>
              </div>
              <div>
                <span>วงเงินใหม่ที่ขอ</span>
                <b className="purple-text">{money(limitDecision.row.amount)}</b>
              </div>
              {limitDecision.row.reason && (
                <div>
                  <span>เหตุผล</span>
                  <b>{limitDecision.row.reason}</b>
                </div>
              )}
              <div>
                <span>ผู้ยื่นคำขอ</span>
                <b>{limitDecision.row.actor ?? "ไม่ระบุ"}</b>
              </div>
            </div>
            <div className="limit-decide-note">
              <ShieldCheck size={15} />{" "}
              {limitDecision.decision === "approve"
                ? `อนุมัติแล้ว วงเงินซื้อสินค้าต่อวันของสมาชิกจะถูกตั้งเป็น ${money(limitDecision.row.amount)} ทันที และบันทึกลง Log`
                : `ปฏิเสธแล้ว วงเงินของสมาชิกคงเดิม (${limitDecision.row.currentLimit != null ? money(limitDecision.row.currentLimit) : "ไม่จำกัด"}) · สมาชิกยื่นคำขอใหม่ได้`}
            </div>
            {limitError && (
              <div className="notice-bar error">
                <ShieldCheck size={16} /> {limitError}
                <button onClick={() => setLimitError("")}>
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="confirm-actions">
              <button
                className="outline-button"
                onClick={() => setLimitDecision(null)}
              >
                ยกเลิก
              </button>
              <button
                className={
                  limitDecision.decision === "approve"
                    ? "primary-button"
                    : "danger-button"
                }
                disabled={decideLimitMutation.isPending}
                onClick={confirmLimitDecision}
              >
                <Check size={16} />{" "}
                {decideLimitMutation.isPending
                  ? "กำลังบันทึก…"
                  : limitDecision.decision === "approve"
                    ? "ยืนยันอนุมัติ"
                    : "ยืนยันปฏิเสธ"}
              </button>
            </div>
          </div>
        </div>
      )}
      {viewedReceipt && (
        <ReceiptModal
          receipt={viewedReceipt}
          onClose={() => setViewedReceipt(null)}
          mode="reprint"
        />
      )}
      {exportPreview && (
        <ExportPreviewModal
          state={exportPreview}
          onClose={() => setExportPreview(null)}
          onRun={format => void runExportPreview(format)}
        />
      )}
      {upgradeFeature && (
        <EditionUpgradeModal
          open
          onClose={() => setUpgradeFeature(null)}
          status={edition.status}
          focusFeature={upgradeFeature}
          onApplied={() => void edition.refetch()}
        />
      )}
      {notice && (
        <div className="notice-bar floating-notice">
          <Check size={16} /> {notice}
          <button onClick={() => setNotice("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
