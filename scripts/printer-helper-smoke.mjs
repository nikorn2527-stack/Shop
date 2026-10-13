import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

if (process.platform === 'win32') {
  const cleanup = spawn('powershell', ['-NoProfile', '-Command', "$ErrorActionPreference='SilentlyContinue'; Get-NetTCPConnection -LocalPort 3031 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }; exit 0"]);
  await new Promise((resolve, reject) => {
    cleanup.once('error', reject);
    cleanup.once('exit', code => code === 0 ? resolve() : reject(new Error(`Port cleanup exited ${code}`)));
  });
}

const printerName = process.env.PRINT_TEST_PRINTER || 'Microsoft Print to PDF';
const helper = spawn('bun', ['index.ts'], {
  cwd: new URL('../mini-services/printer-helper/', import.meta.url),
  env: { ...process.env, PRINTER_HELPER_DRY_RUN: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
helper.stdout.on('data', chunk => { output += chunk; });
helper.stderr.on('data', chunk => { output += chunk; });

try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const health = await fetch('http://127.0.0.1:3031/');
      if (health.ok && (await health.json()).version === '2.0-paper-size') break;
    } catch {}
    if (attempt === 39) throw new Error(`Printer Helper startup timeout\n${output}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  const printersResponse = await fetch('http://127.0.0.1:3031/printers');
  assert.equal(printersResponse.ok, true);
  const printers = await printersResponse.json();
  assert.ok(printers.printers.some(printer => printer.name === printerName), `Printer not found: ${printerName}`);

  for (const width of [58, 72, 80]) {
    const response = await fetch('http://127.0.0.1:3031/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        printerName,
        paperWidthMm: width,
        paperHeightMm: 90,
        content: `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${width}mm 90mm;margin:0}body{margin:0;font-family:Tahoma,sans-serif}.receipt{box-sizing:border-box;width:${width}mm;padding:3mm}</style></head><body><div class="receipt"><b>ทดสอบสลิป ${width} มม.</b><p>Printer Helper dry run</p></div></body></html>`,
      }),
    });
    assert.equal(response.ok, true);
    const result = await response.json();
    assert.equal(result.ok, true, result.message);
    assert.match(result.message, new RegExp(`${width} × 90 มม\\.`));
    assert.equal(result.renderWidthPx, Math.ceil(width * 203 / 25.4));
    assert.equal(result.renderHeightPx, Math.ceil(90 * 203 / 25.4));
    console.log('HELPER_RENDER_PASS', width);
  }

  console.log('PRINTER_HELPER_SMOKE_PASS', printerName);
} finally {
  if (helper.exitCode === null && helper.signalCode === null) {
    helper.kill();
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 2000);
      helper.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}
