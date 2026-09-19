/**
 * Minimal Code128-B barcode renderer — no dependency, renders straight to a
 * <canvas> so both window.print() and html2canvas capture it reliably.
 * The member card / wallet slip use it to print the member number as a
 * real scannable barcode (scanner guns read Code128 out of the box).
 */

// Code128 bar widths: index = code value (0-106). Each entry lists the widths
// of 6 bars (3 bar/space pairs, 11 modules total). Stop (106) carries the
// extra 2-module termination bar.
const WIDTHS: string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const START_CODE_B = 104;
const STOP_CODE = 106;

/** Code128-B checksum: (START_B + Σ value_i × position_i) mod 103 */
function checksum(codes: number[]) {
  let sum = START_CODE_B;
  for (let index = 0; index < codes.length; index += 1) sum += codes[index] * (index + 1);
  return sum % 103;
}

/** ASCII → Code128-B code value (0-94, printable ASCII). */
function charToCode(char: string) {
  const code = char.charCodeAt(0) - 32;
  if (code < 0 || code > 94) return 63; // unsupported char → "?"
  return code;
}

export type BarcodeOptions = {
  /** Bar module width in px (default 2). */
  moduleWidth?: number;
  /** Bar height in px (default 64). */
  height?: number;
  /** Quiet-zone + label padding in px (default 12). */
  padding?: number;
  /** Human-readable caption under the bars (default: the value itself). */
  label?: string;
  /** Pass false to hide the caption. */
  showLabel?: boolean;
};

/** Renders Code128-B of `value` onto a fresh canvas. */
export function code128Canvas(value: string, options: BarcodeOptions = {}) {
  const text = (value ?? "").toString() || " ";
  const moduleWidth = options.moduleWidth ?? 2;
  const height = options.height ?? 64;
  const padding = options.padding ?? 12;
  const showLabel = options.showLabel !== false;
  const label = (options.label ?? text).toString();

  const codes = [START_CODE_B, ...Array.from(text, charToCode), 0, STOP_CODE];
  codes[codes.length - 2] = checksum(codes.slice(0, -2));

  // Flatten bars into [x, width] pairs (module units).
  const bars: { x: number; w: number }[] = [];
  let cursor = 0;
  for (let index = 0; index < codes.length; index += 1) {
    const pattern = WIDTHS[codes[index]];
    const isStop = codes[index] === STOP_CODE;
    const pairs = isStop ? 7 : 6;
    for (let pair = 0; pair < pairs; pair += 1) {
      const width = Number(pattern[pair]);
      if (width <= 0) continue;
      if (pair % 2 === 0) bars.push({ x: cursor, w: width });
      cursor += width;
    }
  }
  const totalModules = cursor;

  const captionFont = 13;
  const captionLine = showLabel ? captionFont + 6 : 0;
  const canvas = document.createElement("canvas");
  canvas.width = totalModules * moduleWidth + padding * 2;
  canvas.height = height + captionLine + padding * 2 - (showLabel ? 0 : padding);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#101418";
  for (const bar of bars) {
    ctx.fillRect(padding + bar.x * moduleWidth, padding, bar.w * moduleWidth, height);
  }
  if (showLabel) {
    ctx.font = `600 ${captionFont}px "Sarabun", "Leelawadee UI", Tahoma, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, canvas.width / 2, padding + height + 4);
  }
  return canvas;
}

/** Code128-B as a PNG data-URL — ready for <img src>, html2canvas and print. */
export function code128DataUrl(value: string, options: BarcodeOptions = {}) {
  try {
    return code128Canvas(value, options).toDataURL("image/png");
  } catch {
    return "";
  }
}
