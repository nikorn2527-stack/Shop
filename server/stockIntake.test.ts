import { describe, expect, it } from "vitest";
import { createSqliteStore, createProduct, receiveStockBatch, stockReceiptHistory, updateProduct, stockReceiptPricing, stockReceiptSource, checkout } from "./sqliteStore";

describe("unified stock intake", () => {
  it("rejects non-finite prices/costs and invalid reorder points before writing", () => {
    const db = createSqliteStore();
    try {
      const existing = createProduct(db, { name: "Validation", sku: "VALIDATION", price: 10 });
      for (const fields of [{ price: Infinity }, { cost: Infinity }, { cost: NaN }, { cost: -1 }, { reorderPoint: 1.5 }, { reorderPoint: -1 }]) {
        expect(() => createProduct(db, { name: "Invalid", sku: "INVALID", price: 10, ...fields })).toThrow();
        expect(() => updateProduct(db, { productId: existing.id, ...fields })).toThrow();
      }
      expect(db.prepare("SELECT id FROM products WHERE sku='INVALID'").get()).toBeUndefined();
      expect(db.prepare("SELECT price, cost FROM products WHERE id=?").get(existing.id)).toMatchObject({ price: 10, cost: 0 });
    } finally { db.close(); }
  });

  it("rejects duplicate tier names that would merge different POS prices", () => {
    const db = createSqliteStore();
    try {
      const priceTiers = JSON.stringify([{ label: "small", price: 5, qty: 100 }, { label: " small ", price: 10, qty: 200 }]);
      expect(() => createProduct(db, { name: "Duplicate tiers", price: 5, sellMode: "money", priceTiers })).toThrow(/ซ้ำ/);
    } finally { db.close(); }
  });
  it("creates new products and receives existing products in one transaction", () => {
    const db = createSqliteStore();
    try {
      const existing = createProduct(db, { name: "Existing intake", sku: "INTAKE-OLD", price: 15 });
      const results = receiveStockBatch(db, [
        { productId: existing.id, purchaseQty: 10, freeQty: 2, paidAmount: 50, lot: "INTAKE-LOT" },
        { newProduct: { name: "New intake", sku: "INTAKE-NEW", barcode: "INTAKE-NEW", price: 20 }, purchaseQty: 5, paidAmount: 25, lot: "NEW-LOT" },
      ], "Intake operator");
      expect(results.map(result => result.product.stock)).toEqual([12, 5]);
      expect(results[0].averageCost).toBe(4.17);
      expect(stockReceiptHistory(db, { search: "INTAKE-LOT" }).reduce((sum, row) => sum + row.receivedQty, 0)).toBe(12);
    } finally { db.close(); }
  });

  it("rolls back new products, existing stock and receipt logs when any entry fails", () => {
    const db = createSqliteStore();
    try {
      const existing = createProduct(db, { name: "Rollback", sku: "ROLLBACK-OLD", price: 10 });
      const logs = db.prepare("SELECT count(*) AS n FROM audit_logs").get();
      expect(() => receiveStockBatch(db, [
        { newProduct: { name: "Must disappear", sku: "ROLLBACK-NEW", price: 20 }, purchaseQty: 3, paidAmount: 9 },
        { productId: existing.id, purchaseQty: 2, paidAmount: 4 },
        { productId: 99999999, purchaseQty: 1, paidAmount: 1 },
      ], "Operator")).toThrow();
      expect(db.prepare("SELECT id FROM products WHERE sku = 'ROLLBACK-NEW'").get()).toBeUndefined();
      expect(db.prepare("SELECT stock FROM products WHERE id = ?").get(existing.id)).toMatchObject({ stock: 0 });
      expect(db.prepare("SELECT count(*) AS n FROM audit_logs").get()).toEqual(logs);
    } finally { db.close(); }
  });

  it("rejects fractional quantities and duplicate barcodes without leaving catalog records", () => {
    const db = createSqliteStore();
    try {
      createProduct(db, { name: "Barcode owner", sku: "BAR-OLD", barcode: "12345678", price: 10 });
      expect(() => receiveStockBatch(db, [{ newProduct: { name: "Duplicate", sku: "BAR-NEW", barcode: "12345678", price: 20 }, purchaseQty: 1, paidAmount: 1 }], "Operator")).toThrow();
      expect(() => receiveStockBatch(db, [{ newProduct: { name: "Fraction", sku: "FRACTION", price: 20 }, purchaseQty: 1.5, paidAmount: 1 }], "Operator")).toThrow();
      expect(db.prepare("SELECT id FROM products WHERE sku IN ('BAR-NEW', 'FRACTION')").all()).toHaveLength(0);
    } finally { db.close(); }
  });
});
describe("receipt price context and atomic repricing", () => {
  it("uses the last actual receipt including free units, and distinguishes unknown from documented zero cost", () => {
    const db=createSqliteStore();
    try {
      const p=createProduct(db,{name:"Previous cost",price:20,cost:99});
      expect(stockReceiptPricing(db,p.id).previousCost).toBeNull();
      receiveStockBatch(db,[{productId:p.id,purchaseQty:10,freeQty:2,paidAmount:60,lot:"FIRST"}],"Receiver");
      expect(stockReceiptPricing(db,p.id)).toMatchObject({previousCost:5,previousLot:"FIRST",sellingPrice:20,highestRemainingCost:5});
      receiveStockBatch(db,[{productId:p.id,purchaseQty:2,paidAmount:18,lot:"NEXT"}],"Receiver");
      expect(stockReceiptPricing(db,p.id)).toMatchObject({previousCost:9,previousLot:"NEXT"});
      receiveStockBatch(db,[{productId:p.id,purchaseQty:1,paidAmount:0,lot:"FREE"}],"Receiver");
      expect(stockReceiptPricing(db,p.id).previousCost).toBe(0);
    } finally {db.close();}
  });
  it.each([25,12])("reprices future sales to %s while retaining old sale prices, exact costs and allocations", newPrice => {
    const db=createSqliteStore();
    try {
      const p=createProduct(db,{name:"Reprice",price:20});
      receiveStockBatch(db,[{productId:p.id,purchaseQty:10,paidAmount:80,lot:"OLD",expiryDate:"2030-01-01"}],"Receiver");
      checkout(db,{items:[{productId:p.id,qty:2}],paymentMethod:"เงินสด"});
      const oldItems=db.prepare("SELECT * FROM sale_items").all();
      const allocations=db.prepare("SELECT * FROM sale_lot_allocations").all();
      const results=receiveStockBatch(db,[{productId:p.id,purchaseQty:5,freeQty:1,paidAmount:60,lot:"NEW",expiryDate:"2031-01-01",sellingPrice:newPrice,expectedSellingPrice:20}],"Receiver");
      expect(results[0].product).toMatchObject({price:newPrice,stock:14});
      expect(db.prepare("SELECT * FROM sale_items").all()).toEqual(oldItems);
      expect(db.prepare("SELECT * FROM sale_lot_allocations").all()).toEqual(allocations);
      checkout(db,{items:[{productId:p.id,qty:1}],paymentMethod:"เงินสด"});
      expect(db.prepare("SELECT price,cost_total_satang AS cost FROM sale_items ORDER BY id DESC LIMIT 1").get()).toMatchObject({price:newPrice,cost:800});
      expect(db.prepare("SELECT detail FROM audit_logs WHERE action='ปรับราคาขายตอนรับเข้า'").get()).toBeDefined();
    } finally {db.close();}
  });
  it("distinguishes repeated manual lot numbers received within the same second", () => {
    const db=createSqliteStore();try {
      const p=createProduct(db,{name:"Shared lot label",price:20});
      receiveStockBatch(db,[{productId:p.id,purchaseQty:10,freeQty:2,paidAmount:60,lot:"SAME"},{productId:p.id,purchaseQty:1,paidAmount:9,lot:"SAME"}],"Receiver");
      expect(stockReceiptPricing(db,p.id)).toMatchObject({previousCost:9,previousLot:"SAME"});
    } finally {db.close();}
  });
  it("rolls back stock, new products and prices on stale/conflicting price drafts or a bad receipt", () => {
    const db=createSqliteStore();
    try {
      const p=createProduct(db,{name:"Atomic price",price:20});
      const entry={productId:p.id,purchaseQty:2,paidAmount:10,sellingPrice:25,expectedSellingPrice:20};
      const before=db.prepare("SELECT stock,price FROM products WHERE id=?").get(p.id);
      expect(()=>receiveStockBatch(db,[entry,{productId:999999,purchaseQty:1,paidAmount:1}],"Receiver")).toThrow();
      expect(()=>receiveStockBatch(db,[entry,{...entry,sellingPrice:26}],"Receiver")).toThrow(/ไม่ตรงกัน/);
      expect(()=>receiveStockBatch(db,[{newProduct:{name:"No phantom",sku:"PHANTOM",price:10},purchaseQty:1,paidAmount:1},{...entry,expectedSellingPrice:19}],"Receiver")).toThrow(/ราคาขายเปลี่ยน/);
      expect(db.prepare("SELECT stock,price FROM products WHERE id=?").get(p.id)).toEqual(before);
      expect(db.prepare("SELECT id FROM products WHERE sku='PHANTOM'").get()).toBeUndefined();
      expect(db.prepare("SELECT COUNT(*) n FROM stock_lots").get()).toMatchObject({n:0});
    } finally {db.close();}
  });
});


describe("receipt cost source references", () => {
  it("links to original paid and free lines after depletion and a later receipt with the same lot label", () => {
    const db=createSqliteStore();try {
      const p=createProduct(db,{name:"Source product",price:20});
      receiveStockBatch(db,[{productId:p.id,purchaseQty:10,freeQty:2,paidAmount:60,lot:"REUSED"}],"First receiver");
      const first=stockReceiptPricing(db,p.id).previousReceipt!;
      expect(first.reference).toBe(`IN-${String(first.id).padStart(6,"0")}`);
      checkout(db,{items:[{productId:p.id,qty:12}],paymentMethod:"เงินสด"});
      receiveStockBatch(db,[{productId:p.id,purchaseQty:1,paidAmount:9,lot:"REUSED"}],"Next receiver");
      const next=stockReceiptPricing(db,p.id).previousReceipt!;
      expect(next.id).not.toBe(first.id);
      const source=stockReceiptSource(db,first.id);
      expect(source).toMatchObject({reference:first.reference,quantity:12,paidAmount:60,unitCost:5});
      expect(source.lines).toHaveLength(2);
      expect(source.lines.map(line=>line.actor)).toEqual(["First receiver","First receiver"]);
      expect(stockReceiptSource(db,source.lines[1].id).reference).toBe(first.reference);
      expect(stockReceiptSource(db,next.id)).toMatchObject({quantity:1,paidAmount:9,unitCost:9});
    } finally {db.close();}
  });
  it("does not invent a source for catalog costs or opening stock, and preserves documented zero cost", () => {
    const db=createSqliteStore();try {
      const p=createProduct(db,{name:"Catalog cost",price:20,cost:99,stock:3});
      expect(stockReceiptPricing(db,p.id)).toMatchObject({previousCost:null,previousReceipt:null});
      const opening={id:Number(db.prepare("INSERT INTO stock_lots (product_id,lot,qty,cost,received_qty,received_at) VALUES (?,'OPENING',3,99,3,'2020-01-01 10:00:00')").run(p.id).lastInsertRowid)};
      expect(()=>stockReceiptSource(db,opening.id)).toThrow("ไม่พบรายการรับเข้า");
      expect(()=>stockReceiptSource(db,999999)).toThrow("ไม่พบรายการรับเข้า");
      receiveStockBatch(db,[{productId:p.id,purchaseQty:1,paidAmount:0}],"Receiver");
      const pricing=stockReceiptPricing(db,p.id);
      expect(stockReceiptSource(db,pricing.previousReceipt!.id)).toMatchObject({quantity:1,paidAmount:0,unitCost:0});
    } finally {db.close();}
  });
  it("shows unknown historical receipt amounts as unknown", () => {
    const db=createSqliteStore();try {
      const p=createProduct(db,{name:"Legacy receipt",price:20});
      receiveStockBatch(db,[{productId:p.id,purchaseQty:2,paidAmount:10}],"Receiver");
      const receipt=stockReceiptPricing(db,p.id).previousReceipt!;
      db.prepare("UPDATE stock_lots SET received_value_satang=NULL,receipt_group=NULL WHERE id=?").run(receipt.id);
      expect(stockReceiptSource(db,receipt.id)).toMatchObject({paidAmount:null,unitCost:null});
    } finally {db.close();}
  });
});
