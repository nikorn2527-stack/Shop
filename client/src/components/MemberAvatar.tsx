/**
 * Member photo with blank fallback.
 * When no photoUrl: show a blank placeholder (no AI photo, no silhouette).
 * FIX-28 (user) — owner บอก: ถ้าไม่มีรูปจริง ให้เว้นว่าง ไม่ใส่รูปคนอื่น
 */
export function MemberAvatar({ member, size = 44, rounded = true }: {
  member: { photoUrl?: string | null; gender?: string | null; firstName?: string; memberNumber?: string };
  size?: number;
  rounded?: boolean;
}) {
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

  // FIX-28 — blank placeholder (no photo = empty box with border)
  return (
    <span
      className={`member-photo-blank${rounded ? " round" : " id-portrait"}`}
      style={{ width: size, height: rounded ? size : Math.round(size * 1.33) }}
      role="img"
      aria-label="ยังไม่มีรูปสมาชิก"
    />
  );
}
