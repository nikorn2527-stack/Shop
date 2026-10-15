import { useState } from "react";
import "../styles/cost-profit.css";
import { trpc } from "@/lib/trpc";
import { ThaiDateRangePicker } from "@/components/ThaiDateRangePicker";
import { SectionHeader } from "./PagePrimitives";
import { money } from "./pageData";
import { formatThaiDate } from "./viewFormat";

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Sales and cost reports use the snapshots recorded when each sale was made. */
export default function CostProfit() {
  const [view, setView] = useState<"products" | "daily">("products");
  const [range, setRange] = useState<"today" | "month" | "custom">("today");
  const [from, setFrom] = useState(localDate);
  const [to, setTo] = useState(localDate);
  const [sort, setSort] = useState<{ key: "date" | "orders" | "revenue" | "cogs" | "profit" | "marginPct"; descending: boolean }>({ key: "date", descending: true });
  const valid = Boolean(from && to && from <= to);
  const query = trpc.reports.daily.useQuery({ from, to }, { enabled: valid });
  const productsQuery = trpc.reports.byProduct.useQuery({ from, to }, { enabled: valid });
  const productRows = productsQuery.data ?? [];
  const productTotals = productRows.reduce((sum, row) => ({
    revenue: sum.revenue + row.revenue, cogs: sum.cogs + row.cogs,
  }), { revenue: 0, cogs: 0 });
  const rows = query.data ?? [];
  const sortedRows = [...rows].sort((a, b) => {
    const comparison = sort.key === "date" ? a.date.localeCompare(b.date) : Number(a[sort.key]) - Number(b[sort.key]);
    return sort.descending ? -comparison : comparison;
  });
  function sortBy(key: typeof sort.key) {
    setSort(previous => ({ key, descending: previous.key === key ? !previous.descending : true }));
  }
  const totals = rows.reduce((sum, row) => ({
    revenue: sum.revenue + row.revenue,
    cost: sum.cost + row.cogs,
    orders: sum.orders + row.orders,
  }), { revenue: 0, cost: 0, orders: 0 });
  const profit = totals.revenue - totals.cost;
  const ready = valid && !query.isLoading && !query.isError;
  const cards = [
    ["ยอดขายสุทธิ", money(totals.revenue)],
    ["ต้นทุนขายที่บันทึก", money(totals.cost)],
    ["กำไรขั้นต้นเบื้องต้น", money(profit)],
    ["อัตรากำไรเบื้องต้น", `${totals.revenue > 0 ? (profit / totals.revenue * 100).toFixed(2) : "0.00"}%`],
  ];
  function choose(next: typeof range) {
    setRange(next);
    if (next === "custom") return;
    const today = new Date();
    setTo(localDate(today));
    setFrom(next === "month" ? localDate(new Date(today.getFullYear(), today.getMonth(), 1)) : localDate(today));
  }
  return <section className="cost-profit-page">
    <SectionHeader eyebrow="การเงิน" title="ต้นทุนและกำไร" description="สินค้าที่ยังไม่มีต้นทุนจะใช้ราคาขายเป็นต้นทุนประเมิน เพื่อไม่ให้กำไรสูงเกินจริง" />
    <div className="cost-profit-filters">
      <div className="cost-profit-ranges" aria-label="ช่วงเวลาต้นทุนและกำไร">
        {([['today', 'วันนี้'], ['month', 'เดือนนี้'], ['custom', 'กำหนดเอง']] as const).map(([value, label]) =>
          <button type="button" className={range === value ? "primary-button" : "outline-button"} aria-pressed={range === value} key={value} onClick={() => choose(value)}>{label}</button>)}
      </div>
      <label>ช่วงวันที่<ThaiDateRangePicker from={from} to={to} onChange={(nextFrom, nextTo) => { setRange("custom"); setFrom(nextFrom); setTo(nextTo); }} ariaLabel="เลือกช่วงวันที่ต้นทุนและกำไร" /></label>
    </div>
    {!valid && <p role="alert">กรุณาเลือกวันที่เริ่มต้นไม่เกินวันที่สิ้นสุด</p>}
    {query.isError && <p role="alert">โหลดข้อมูลไม่สำเร็จ: {query.error.message} <button type="button" className="outline-button" onClick={() => void query.refetch()}>ลองอีกครั้ง</button></p>}
    <div className="cost-profit-cards">{cards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{ready ? value : "—"}</strong></article>)}</div>
    {ready && totals.orders === 0 && <p role="status" className="cost-profit-empty">ไม่มีบิลขายในช่วงวันที่เลือก {range === "today" && <button type="button" className="outline-button" onClick={() => choose("month")}>ดูเดือนนี้</button>}</p>}
    <div className="cost-profit-tabs" role="tablist" aria-label="มุมมองต้นทุนและกำไร">
      {([['products', 'รายละเอียดตามสินค้า'], ['daily', 'สรุปรายวัน']] as const).map(([value, label]) =>
        <button key={value} type="button" role="tab" id={`cost-profit-tab-${value}`} aria-selected={view === value} aria-controls={`cost-profit-panel-${value}`} onClick={() => setView(value)}>{label}</button>)}
    </div>
    {view === "products" && <article className="cost-profit-detail" role="tabpanel" id="cost-profit-panel-products" aria-labelledby="cost-profit-tab-products">
      <header><div><h2>รายละเอียดตามสินค้า</h2><span>{valid ? `${formatThaiDate(from)} – ${formatThaiDate(to)}` : "—"}</span></div><span>{productRows.length} รายการ</span></header>
      {productsQuery.isError && <p role="alert">โหลดรายละเอียดสินค้าไม่สำเร็จ: {productsQuery.error.message} <button type="button" className="outline-button" onClick={() => void productsQuery.refetch()}>ลองอีกครั้ง</button></p>}
      <div className="cost-profit-table cost-profit-products" tabIndex={0} role="region" aria-label="ตารางต้นทุนและกำไรแยกสินค้า" aria-busy={productsQuery.isFetching}>
        <table><thead><tr><th className="text-cell">บาร์โค้ดสินค้า</th><th className="text-cell">สินค้า</th><th className="text-cell">ชนิด / หมวดสินค้า</th><th className="numeric-cell">จำนวนขาย</th><th className="numeric-cell">จำนวนบิล</th><th className="numeric-cell">ยอดขายก่อนส่วนลด</th><th className="numeric-cell">ต้นทุนขาย</th><th className="numeric-cell">กำไรก่อนส่วนลด</th><th className="numeric-cell">อัตรากำไรก่อนส่วนลด</th></tr></thead>
          <tbody>{!valid || productsQuery.isLoading ? <tr><td className="empty-cell" colSpan={9}>{valid ? "กำลังโหลดข้อมูล…" : "กรุณาเลือกช่วงวันที่"}</td></tr> : productsQuery.isError ? null : productRows.length ? productRows.map(row => <tr key={row.productId ?? "special"}><td className="text-cell product-code">{row.productId === null ? "—" : row.barcode || "ไม่มีบาร์โค้ด"}</td><td className="text-cell">{row.name}</td><td className="text-cell">{row.category || "ไม่ระบุ"}</td><td className="numeric-cell">{row.qty.toLocaleString("th-TH")}</td><td className="numeric-cell">{row.bills.toLocaleString("th-TH")}</td><td className="numeric-cell">{money(row.revenue)}</td><td className="numeric-cell">{money(row.cogs)}</td><td className="numeric-cell">{money(row.profit)}</td><td className="numeric-cell">{row.marginPct.toFixed(2)}%</td></tr>) : <tr><td className="empty-cell" colSpan={9}>ไม่มีรายการในช่วงวันที่เลือก</td></tr>}</tbody>
          {valid && !productsQuery.isLoading && !productsQuery.isError && <tfoot><tr><th className="text-cell" colSpan={5}>รวม {productRows.length} รายการสินค้า</th><td className="numeric-cell">{money(productTotals.revenue)}</td><td className="numeric-cell">{money(productTotals.cogs)}</td><td className="numeric-cell">{money(productTotals.revenue - productTotals.cogs)}</td><td className="numeric-cell">{productTotals.revenue > 0 ? ((productTotals.revenue - productTotals.cogs) / productTotals.revenue * 100).toFixed(2) : "0.00"}%</td></tr></tfoot>}
        </table>
      </div>
    </article>}
    {view === "daily" && <article className="cost-profit-detail" role="tabpanel" id="cost-profit-panel-daily" aria-labelledby="cost-profit-tab-daily">
      <header><div><h2>สรุปรายวัน</h2><span>{valid ? `${formatThaiDate(from)} – ${formatThaiDate(to)}` : "—"}</span></div><span>{ready ? `${totals.orders.toLocaleString("th-TH")} บิล` : "—"}</span></header>
      <div className="cost-profit-table" tabIndex={0} role="region" aria-label="ตารางต้นทุนและกำไรรายวัน" aria-busy={query.isFetching}><table><thead><tr>{([
        ["date", "วันที่"], ["orders", "จำนวนบิล"], ["revenue", "ยอดขายสุทธิ"], ["cogs", "ต้นทุนขาย"], ["profit", "กำไรขั้นต้น"], ["marginPct", "อัตรากำไร"],
      ] as const).map(([key, label]) => <th className={key === "date" ? "text-cell" : "numeric-cell"} key={key} aria-sort={sort.key === key ? sort.descending ? "descending" : "ascending" : "none"}><button type="button" onClick={() => sortBy(key)}>{label} <span aria-hidden="true">{sort.key === key ? sort.descending ? "↓" : "↑" : "↕"}</span></button></th>)}</tr></thead>
        <tbody>{ready ? sortedRows.map(row => <tr key={row.date}><td className="text-cell">{formatThaiDate(row.date)}</td><td className="numeric-cell">{row.orders.toLocaleString("th-TH")}</td><td className="numeric-cell">{money(row.revenue)}</td><td className="numeric-cell">{money(row.cogs)}</td><td className="numeric-cell">{money(row.profit)}</td><td className="numeric-cell">{row.marginPct.toFixed(2)}%</td></tr>) : <tr><td className="empty-cell" colSpan={6}>{query.isLoading ? "กำลังโหลดข้อมูล…" : "ยังไม่สามารถแสดงข้อมูลได้"}</td></tr>}
        {ready && !rows.length && <tr><td className="empty-cell" colSpan={6}>ไม่มีรายการในช่วงวันที่เลือก</td></tr>}</tbody>
        {ready && <tfoot><tr><th className="text-cell">รวม</th><td className="numeric-cell">{totals.orders.toLocaleString("th-TH")}</td><td className="numeric-cell">{money(totals.revenue)}</td><td className="numeric-cell">{money(totals.cost)}</td><td className="numeric-cell">{money(profit)}</td><td className="numeric-cell">{cards[3][1]}</td></tr></tfoot>}
      </table></div>
    </article>}
  </section>;
}