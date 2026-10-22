import { categoryEmoji } from "./productCategories";

/** Local illustrations for products sold from the counter panel, also available to the full catalog. */
export const PRODUCT_ICONS = [
  {
    id: "stamp",
    label: "แสตมป์",
    category: "เครื่องเขียน",
    emoji: "🎟️",
    aliases: ["แสตมป์", "สแตมป์"],
    imageUrl: "/images/product-icons/stamp.svg",
  },
  {
    id: "envelope",
    label: "ซองจดหมาย",
    category: "เครื่องเขียน",
    emoji: "✉️",
    aliases: ["ซองจดหมาย", "ซองเอกสาร"],
    imageUrl: "/images/product-icons/envelope.svg",
  },
  {
    id: "coffee-set",
    label: "ชุดแก้วกาแฟ",
    category: "ของใช้",
    emoji: "☕",
    aliases: ["ชุดแก้วกาแฟ", "แก้วกาแฟ", "ชุดกาแฟ"],
    imageUrl: "/images/product-icons/coffee-set.svg",
  },
  {
    id: "cloth-bag",
    label: "ถุงผ้า",
    category: "ของใช้",
    emoji: "🛍️",
    aliases: ["ถุงผ้า", "กระเป๋าผ้า"],
    imageUrl: "/images/product-icons/cloth-bag.svg",
  },
  {
    id: "towel",
    label: "ผ้าเช็ดตัว",
    category: "ของใช้",
    emoji: "🧺",
    aliases: ["ผ้าเช็ดตัว", "ผ้าขนหนู"],
    imageUrl: "/images/product-icons/towel.svg",
  },
  {
    id: "sandals",
    label: "รองเท้าแตะ",
    category: "ของใช้",
    emoji: "🩴",
    aliases: ["รองเท้าแตะ", "รองเท้า"],
    imageUrl: "/images/product-icons/sandals.svg",
  },
  {
    id: "ice",
    label: "น้ำแข็ง",
    category: "อาหาร",
    emoji: "🧊",
    aliases: ["น้ำแข็ง"],
    imageUrl: "/images/product-icons/ice.svg",
  },
  {
    id: "scrubber",
    label: "ฝอยขัดหม้อ",
    category: "ของใช้",
    emoji: "🧽",
    aliases: ["ฝอยขัดหม้อ", "ฟองน้ำล้างจาน"],
    imageUrl: "/images/product-icons/scrubber.svg",
  },
  {
    id: "body-sponge",
    label: "ฟองขัดตัว",
    category: "ของใช้",
    emoji: "🧽",
    aliases: ["ฟองขัดตัว", "ฟองน้ำขัดตัว", "ใยขัดตัว"],
    imageUrl: "/images/product-icons/body-sponge.svg",
  },
  {
    id: "socks",
    label: "ถุงเท้า",
    category: "ของใช้",
    emoji: "🧦",
    aliases: ["ถุงเท้า"],
    imageUrl: "/images/product-icons/socks.svg",
  },
  {
    id: "comb",
    label: "หวี",
    category: "ของใช้",
    emoji: "💇",
    aliases: ["หวี"],
    imageUrl: "/images/product-icons/comb.svg",
  },
  {
    id: "shower-cap",
    label: "หมวกอาบน้ำ",
    category: "ของใช้",
    emoji: "🛁",
    aliases: ["หมวกอาบน้ำ"],
    imageUrl: "/images/product-icons/shower-cap.svg",
  },
  {
    id: "underwear",
    label: "กางเกงใน",
    category: "ของใช้",
    emoji: "🩲",
    aliases: ["กางเกงใน"],
    imageUrl: "/images/product-icons/underwear.svg",
  },
  {
    id: "bra",
    label: "เสื้อชั้นใน",
    category: "ของใช้",
    emoji: "👙",
    aliases: ["เสื้อชั้นใน", "ยกทรง"],
    imageUrl: "/images/product-icons/bra.svg",
  },
  {
    id: "basket",
    label: "ตะกร้า",
    category: "ของใช้",
    emoji: "🧺",
    aliases: ["ตะกร้า"],
    imageUrl: "/images/product-icons/basket.svg",
  },
  {
    id: "hair-tie",
    label: "ยางรัดผม",
    category: "ของใช้",
    emoji: "🎀",
    aliases: ["ยางรัดผม", "กิ๊บ"],
    imageUrl: "/images/product-icons/hair-tie.svg",
  },
  {
    id: "soap",
    label: "สบู่",
    category: "ของใช้",
    emoji: "🧼",
    aliases: ["สบู่"],
    imageUrl: "/images/product-icons/soap.svg",
  },
  {
    id: "toothbrush",
    label: "แปรงสีฟัน",
    category: "ของใช้",
    emoji: "🪥",
    aliases: ["แปรงสีฟัน"],
    imageUrl: "/images/product-icons/toothbrush.svg",
  },
  {
    id: "toothpaste",
    label: "ยาสีฟัน",
    category: "ของใช้",
    emoji: "🦷",
    aliases: ["ยาสีฟัน"],
    imageUrl: "/images/product-icons/toothpaste.svg",
  },
  {
    id: "shampoo",
    label: "แชมพู",
    category: "ของใช้",
    emoji: "🧴",
    aliases: ["แชมพู", "ครีมนวด"],
    imageUrl: "/images/product-icons/shampoo.svg",
  },
  {
    id: "tissue",
    label: "กระดาษทิชชู",
    category: "ของใช้",
    emoji: "🧻",
    aliases: ["ทิชชู", "ทิชชู่", "กระดาษชำระ"],
    imageUrl: "/images/product-icons/tissue.svg",
  },
  {
    id: "plastic-bag",
    label: "ถุงพลาสติก",
    category: "ของใช้",
    emoji: "🛍️",
    aliases: ["ถุงพลาสติก", "ถุงหิ้ว"],
    imageUrl: "/images/product-icons/plastic-bag.svg",
  },
  {
    id: "cup",
    label: "แก้วน้ำ",
    category: "ของใช้",
    emoji: "🥛",
    aliases: ["แก้วน้ำ"],
    imageUrl: "/images/product-icons/cup.svg",
  },
  {
    id: "bowl",
    label: "ชาม",
    category: "ของใช้",
    emoji: "🥣",
    aliases: ["ชาม", "ถ้วย"],
    imageUrl: "/images/product-icons/bowl.svg",
  },
  {
    id: "spoon",
    label: "ช้อนส้อม",
    category: "ของใช้",
    emoji: "🍴",
    aliases: ["ช้อน", "ส้อม"],
    imageUrl: "/images/product-icons/spoon.svg",
  },
  {
    id: "rice",
    label: "ข้าวและอาหาร",
    category: "อาหาร",
    emoji: "🍱",
    aliases: ["ข้าว", "อาหาร"],
    imageUrl: "/images/product-icons/rice.svg",
  },
  {
    id: "noodles",
    label: "บะหมี่",
    category: "อาหาร",
    emoji: "🍜",
    aliases: ["บะหมี่", "มาม่า", "ยำยำ"],
    imageUrl: "/images/product-icons/noodles.svg",
  },
  {
    id: "ice-cream",
    label: "ไอศกรีม",
    category: "ไอศกรีม",
    emoji: "🍦",
    aliases: ["ไอศกรีม", "ไอติม"],
    imageUrl: "/images/product-icons/ice-cream.svg",
  },
  {
    id: "drink",
    label: "น้ำดื่ม",
    category: "เครื่องดื่ม",
    emoji: "🥤",
    aliases: ["น้ำดื่ม", "น้ำเปล่า"],
    imageUrl: "/images/product-icons/drink.svg",
  },
  {
    id: "snack",
    label: "ขนม",
    category: "ขนม",
    emoji: "🍪",
    aliases: ["ขนม", "คุกกี้"],
    imageUrl: "/images/product-icons/snack.svg",
  },
  {
    id: "pen",
    label: "ปากกา",
    category: "เครื่องเขียน",
    emoji: "🖊️",
    aliases: ["ปากกา"],
    imageUrl: "/images/product-icons/pen.svg",
  },
  {
    id: "notebook",
    label: "สมุด",
    category: "เครื่องเขียน",
    emoji: "📒",
    aliases: ["สมุด"],
    imageUrl: "/images/product-icons/notebook.svg",
  },
] as const;

const manualProductAliases = PRODUCT_ICONS.flatMap(icon =>
  icon.aliases.map(alias => ({ icon, alias }))
).sort((a, b) => b.alias.length - a.alias.length);

type ProductArtworkInput = {
  name?: string;
  category?: string | null;
  emoji?: string | null;
  imageUrl?: string | null;
  barcode?: string | null;
};

/** Explicit photos and chosen icons win. Infer missing artwork for manual/short-code products without writing to the catalog. */
export function resolveProductArtwork(product: ProductArtworkInput) {
  const emoji = product.emoji?.trim() || categoryEmoji(product.category);
  if (product.imageUrl) return { imageUrl: product.imageUrl, emoji };
  if (product.emoji?.trim()) return { imageUrl: null, emoji };
  const barcode = product.barcode?.trim() || "";
  if (barcode.length < 5 && product.name) {
    const name = product.name.normalize("NFC").toLowerCase();
    const match = manualProductAliases.find(({ alias }) =>
      name.includes(alias)
    );
    if (match)
      return { imageUrl: match.icon.imageUrl, emoji: match.icon.emoji };
  }
  return { imageUrl: null, emoji };
}
