# -*- coding: utf-8 -*-
import io

path = "client/src/reportDoc.ts"
with io.open(path, "r", encoding="utf-8") as f:
    src = f.read()

old = '''import { printViaHelper, getPrinterName } from "@/lib/printHelper";
import {
'''

new = '''import { printViaHelper, getPrinterName } from "@/lib/printHelper";
import {
  buildReportDocumentHtml,
  thaiStamp,
  REPORT_DOC_CSS,
  type ReportDocConfig,
} from "@shared/reportDoc";
'''

assert src.count(old) == 1, src.count(old)
src = src.replace(old, new)

with io.open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
