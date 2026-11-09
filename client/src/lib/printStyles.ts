/**
 * Snapshot the CSS the open page already loaded. A deployment can remove the
 * hashed stylesheet URL while that page is still open; linking it again in a
 * print iframe would then produce an unstyled receipt.
 */
export function capturePrintStyles(doc: Document = document): string {
  return Array.from(
    doc.querySelectorAll('style, link[rel="stylesheet"]'),
    element => {
      const sheet = (element as HTMLStyleElement | HTMLLinkElement).sheet;
      if (sheet?.disabled) return "";
      try {
        if (!sheet) return element.outerHTML;
        const css = Array.from(sheet.cssRules, rule => rule.cssText).join("\n");
        const media = sheet.media.mediaText;
        const mediaAttribute = media
          ? ` media="${media.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")}"`
          : "";
        return `<style${mediaAttribute}>${css.replace(/<\/style/gi, "<\\/style")}</style>`;
      } catch {
        // Cross-origin stylesheets can be readable by the page but opaque to CSSOM.
        return element.outerHTML;
      }
    }
  ).join("\n");
}

/** Restore the same loaded styles in a canvas clone before measuring its text. */
export async function applyPrintStylesSnapshot(
  doc: Document,
  styles: string,
  targetId: string
): Promise<void> {
  doc.head.insertAdjacentHTML("beforeend", styles);
  doc.getElementById(targetId)?.getBoundingClientRect();
  await doc.fonts?.ready;
}
