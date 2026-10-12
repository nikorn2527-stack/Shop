# -*- coding: utf-8 -*-
import io

path = "client/src/lib/printHelper.ts"
with io.open(path, "r", encoding="utf-8") as f:
    src = f.read()

orphan = '''export const PRINTER_DOC_LABELS: Record<PrintDocType, string> = {
  receipt: "ใบเสร็จ",
  report: "รายงาน",
  card: "บัตรสมาชิก",
};
  return getLocalPrinterSettings()[docType];
}
'''

fixed = '''export const PRINTER_DOC_LABELS: Record<PrintDocType, string> = {
  receipt: "ใบเสร็จ",
  report: "รายงาน",
  card: "บัตรสมาชิก",
};
'''

assert src.count(orphan) == 1, src.count(orphan)
src = src.replace(orphan, fixed)

with io.open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
