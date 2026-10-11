# Page Template Guidelines — มาตรฐานการออกแบบหน้าจอ

## โครงสร้างมาตรฐาน (ทุกหน้าใช้โครงเดียวกัน)

```
PageTemplate
├── PageTemplate.Header
│   ├── eyebrow (หมวด เช่น "สรุปผลและวิเคราะห์ข้อมูล")
│   ├── title (ชื่อหน้า เช่น "รายงาน")
│   ├── description (คำอธิบายสั้น 1 บรรทัด)
│   └── action (Primary Action — ปุ่มเดียวเท่านั้น)
├── PageTemplate.Toolbar
│   ├── search (ช่องค้นหา)
│   ├── filters (chips กรอง + date picker + ปุ่มเลือกช่วง)
│   └── viewOptions (สลับมุมมอง/แท็บ)
├── PageTemplate.Content
│   ├── summary (การ์ดสถิติ ถ้ามี)
│   ├── table หรือ cards (ข้อมูลหลัก)
│   └── EmptyState (เมื่อไม่มีข้อมูล/โหลด/error)
└── PageTemplate.ContextualBar (แสดงเมื่อเลือกข้อมูล)
```

## กฎการออกแบบ (ห้ามผิด)

### 1. ปุ่ม Primary — สีเขียว 1 ปุ่ม/หน้า
- ปุ่มเด่นที่สุดอยู่ **ขวาบนของ Header** เสมอ
- สีเขียว (`--teal`) เฉพาะปุ่ม Primary เท่านั้น
- ปุ่มอื่นทั้งหมดใช้ `outline-button` (ไม่มีสีเขียว)
- ตัวอย่างผิด: มีปุ่มเขียว 3 ปุ่มในหน้าเดียว → ไม่รู้ปุ่มไหนสำคัญ

### 2. Tabs — สไตล์เดียวกัน
- ใช้ `.dash-tab` (แถบแท็บแนวนอน) ทุกที่
- ห้ามผสม: บางหน้าใช้ tabs บางหน้าใช้ pills บางหน้าใช้ dropdown
- ถ้าเป็นตัวเลือกแบบเลือกได้หลาย → ใช้ pills
- ถ้าเป็นสลับมุมมอง → ใช้ tabs

### 3. Modal — ไม่ซ้อนเกิน 1 ระดับ
- ไม่มี modal ใน modal
- ถ้าต้องการยืนยันเพิ่ม → ใช้ ConfirmDialog (เป็น modal แยก ไม่ซ้อน)
- ถ้าต้องการหลายขั้น → ใช้ stepper/wizard ใน modal เดียว (เปลี่ยน content ไม่ซ้อน modal)

### 4. ตาราง — ปุ่มจัดการ inline
- ปุ่มจัดการ (แก้ไข/ลบ/ดู) อยู่ในแถวสุดท้ายของแถว (inline)
- ไม่ต้องเลื่อนแนวนอนเพื่อหาปุ่ม
- ถ้าคอลัมน์เยอะ → ซ่อนคอลัมน์รองในมือถือ (`hide-sm`)
- ถ้าข้อมูลยาว → ใช้ 2 บรรทัด/แถว (detail row) ไม่ใช้ horizontal scroll

### 5. Empty / Loading / Error — ใช้ EmptyState
- ทุกหน้าใช้ `<EmptyState>` component เดียวกัน
- ไม่เขียน HTML ว่างๆ แต่ละหน้า
- variant: `loading` (โหลด) / `error` (ผิดพลาด) / `neutral` (ไม่มีข้อมูล)

### 6. Toolbar — จัดกลุ่ม
- search + filters + date picker อยู่ในแถวเดียวกัน (Toolbar)
- ไม่แยก date picker ไปอีกบรรทัด (เหมือนที่เคยแก้ใน UI-10)
- ปุ่ม export (CSV/Excel/PDF) อยู่ท้าย Toolbar ทางขวา

## การนำไปใช้

ทุกหน้าควรใช้:
```tsx
<PageTemplate>
  <PageTemplate.Header title="..." description="..." action={<PrimaryButton />} />
  <PageTemplate.Toolbar>
    <Search />
    <FilterBar>...</FilterBar>
  </PageTemplate.Toolbar>
  <PageTemplate.Content>
    <DataTable>...</DataTable>
  </PageTemplate.Content>
</PageTemplate>
```
