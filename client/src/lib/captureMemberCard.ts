import { MEMBER_CARD_WIDTH_PX as width, MEMBER_CARD_HEIGHT_PX as height, MEMBER_CARD_IMAGE_WIDTH as imageWidth, MEMBER_CARD_IMAGE_HEIGHT as imageHeight } from "@shared/memberCardSize";
/** Rasterize the browser's own Thai text shaping, rather than drawing individual glyphs. */
let fontCssPromise: Promise<string> | undefined;
async function asDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const response = await fetch(url);
  if (!response.ok) throw new Error("โหลดรูปหรือฟอนต์บัตรไม่สำเร็จ");
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("อ่านรูปหรือฟอนต์บัตรไม่สำเร็จ"));
    reader.readAsDataURL(blob);
  });
}
function cardFonts(): Promise<string> {
  return fontCssPromise ??= Promise.all([400, 600, 700].flatMap(weight => ["thai", "latin"].map(async subset => {
    const data = await asDataUrl(`/fonts/Sarabun-${weight}-${subset}.woff2`);
    return `@font-face{font-family:Sarabun;font-style:normal;font-weight:${weight};src:url("${data}") format("woff2");unicode-range:${subset === "thai" ? "U+0E01-0E5B,U+200C-200D,U+25CC" : "U+0000-00FF,U+2000-206F"}}`;
  }))).then(rules => rules.join("\n")).catch(error => { fontCssPromise = undefined; throw error; });
}
export async function captureMemberCard(element: HTMLElement): Promise<HTMLCanvasElement> {
  await document.fonts.ready;
  await Promise.all(Array.from(element.querySelectorAll("img"), image => image.decode()));
  const copy = element.cloneNode(true) as HTMLElement;
  const originals = [element, ...Array.from(element.querySelectorAll<HTMLElement>("*"))];
  const clones = [copy, ...Array.from(copy.querySelectorAll<HTMLElement>("*"))];
  originals.forEach((node, index) => {
    const style = getComputedStyle(node);
    for (const property of Array.from(style)) clones[index].style.setProperty(property, style.getPropertyValue(property));
    clones[index].removeAttribute("id");
  });
  // The capture host may be off screen or inside a scaled sheet. Export a clean ID-1 artboard.
  copy.style.cssText += `;position:relative;left:0;top:0;margin:0;transform:none;width:${width}px;min-width:${width}px;max-width:${width}px;height:${height}px;min-height:${height}px;max-height:${height}px;border-radius:0;box-shadow:none;`;
  await Promise.all(Array.from(copy.querySelectorAll("img"), async image => { image.src = await asDataUrl(image.src); }));
  const style = document.createElement("style");
  style.textContent = await cardFonts();
  copy.prepend(style);
  const markup = new XMLSerializer().serializeToString(copy);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${width} ${height}"><foreignObject width="${width}" height="${height}">${markup}</foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = imageWidth; canvas.height = imageHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("สร้างภาพบัตรไม่สำเร็จ");
  context.fillStyle = "white"; context.fillRect(0, 0, imageWidth, imageHeight);
  context.drawImage(image, 0, 0);
  return canvas;
}
