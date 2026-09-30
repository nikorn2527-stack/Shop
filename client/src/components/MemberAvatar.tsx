/**
 * Member photo with gender-based fallback.
 * The member card / pickers / confirm dialogs all share it so the cashier
 * can visually verify WHO they are about to charge — photo first, otherwise
 * a realistic AI-generated Thai portrait (male/female/neutral) from the
 * project's public assets.
 *
 * FIX-11 (user) — replaced the flat SVG illustration (which looked like a
 * "dummy/mannequin") with AI-generated realistic Thai portrait photos stored
 * at /images/member-photo-{male|female|neutral}.png. These look like real
 * ID-style photos, not cartoon avatars. When `rounded=false` (used by the
 * wallet card), the fallback renders as portrait-oriented (3:4) ID-style photo.
 */
const FALLBACK_PHOTOS: Record<string, string> = {
  male: "/images/member-photo-male.png",
  female: "/images/member-photo-female.png",
  neutral: "/images/member-photo-neutral.png",
};

export function MemberAvatar({ member, size = 44, rounded = true }: {
  member: { photoUrl?: string | null; gender?: string | null; firstName?: string; memberNumber?: string };
  size?: number;
  rounded?: boolean;
}) {
  const gender = member.gender === "ชาย" ? "ชาย" : member.gender === "หญิง" ? "หญิง" : "ไม่ระบุ";
  const initial = (member.firstName ?? member.memberNumber ?? "?").trim().slice(0, 1) || "?";
  const fallbackKey = gender === "ชาย" ? "male" : gender === "หญิง" ? "female" : "neutral";
  const fallbackSrc = FALLBACK_PHOTOS[fallbackKey];

  if (member.photoUrl) {
    return (
      <img
        className={`member-photo${rounded ? " round" : " id-portrait"}`}
        src={member.photoUrl}
        alt={`รูปสมาชิก${member.firstName ?? ""}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // FIX-11 — use AI-generated realistic portrait instead of SVG illustration
  return (
    <img
      className={`member-photo-fallback-photo${rounded ? " round" : " id-portrait"}`}
      src={fallbackSrc}
      alt={`ไม่มีรูปสมาชิก · ใช้รูป${gender === "ไม่ระบุ" ? "เริ่มต้น" : gender}`}
      style={{ width: size, height: rounded ? size : Math.round(size * 1.33), objectFit: "cover", objectPosition: "center top" }}
      loading="lazy"
    />
  );
}
