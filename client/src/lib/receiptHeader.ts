import { parseBangkokDate, STORE_TIME_ZONE } from "@shared/storeTime";

export function receiptHeaderDateTime(value: string): {
  date: string;
  time: string;
} {
  const date = parseBangkokDate(value);
  if (!date) return { date: value, time: "—" };
  return {
    date: date.toLocaleDateString("th-TH", {
      timeZone: STORE_TIME_ZONE,
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    time: `${date.toLocaleTimeString("th-TH", { timeZone: STORE_TIME_ZONE, hourCycle: "h23", hour: "2-digit", minute: "2-digit" })} น.`,
  };
}

/** Format for display only; the saved store address is never updated. */
export function receiptAddressLines(
  value: string | undefined | null
): { text: string; contact: boolean }[] {
  return (value ?? "")
    .split(/\r?\n|(?=โทรศัพท์|โทรสาร)/)
    .map(text => text.trim())
    .filter(Boolean)
    .flatMap((text, index) => {
      const contact = /^(โทรศัพท์|โทรสาร)/.test(text);
      // Separate a flat organisation/address line only when there is a recognisable street-number marker.
      const address = !contact && index === 0
        ? text.match(
            /^(.+?)\s+((?:เลขที่\s*)?\d[\d/.-]*\s+(?:หมู่|ม\.|ถนน|ถ\.|ซอย)\s*.+)$/
          )
        : null;
      return address
        ? [
            { text: address[1], contact: false },
            { text: address[2], contact: false },
          ]
        : [{ text, contact }];
    });
}
