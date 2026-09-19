/**
 * Member photo with gender-based fallback avatar.
 * The member card / pickers / confirm dialogs all share it so the cashier
 * can visually verify WHO they are about to charge — photo first, otherwise
 * a male / female silhouette from the gender field.
 */
export function MemberAvatar({ member, size = 44, rounded = true }: {
  member: { photoUrl?: string | null; gender?: string | null; firstName?: string; memberNumber?: string };
  size?: number;
  rounded?: boolean;
}) {
  const gender = member.gender === "ชาย" ? "ชาย" : member.gender === "หญิง" ? "หญิง" : "ไม่ระบุ";
  const initial = (member.firstName ?? member.memberNumber ?? "?").trim().slice(0, 1) || "?";
  if (member.photoUrl) {
    return (
      <img
        className={`member-photo${rounded ? " round" : ""}`}
        src={member.photoUrl}
        alt={`รูปสมาชิก${member.firstName ?? ""}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const isMale = gender === "ชาย";
  const isFemale = gender === "หญิง";
  return (
    <span
      className={`member-photo-fallback ${isMale ? "male" : isFemale ? "female" : "neutral"}${rounded ? " round" : ""}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`ไม่มีรูปสมาชิก · ใช้รูป${gender === "ไม่ระบุ" ? "เริ่มต้น" : gender}`}
    >
      <svg viewBox="0 0 48 48" width={Math.round(size * 0.72)} height={Math.round(size * 0.72)} aria-hidden="true">
        {isFemale ? (
          <>
            <circle cx="24" cy="17" r="8.4" fill="currentColor" />
            <path d="M24 26.6c-6.4 0-11.6 4.1-12.9 9.9-.3 1.4.7 2.7 2.1 2.7h21.6c1.4 0 2.4-1.3 2.1-2.7-1.3-5.8-6.5-9.9-12.9-9.9z" fill="currentColor" />
            <path d="M15.8 15.2c1.2-4.9 5.7-7.9 10.9-7 3.4.6 6 2.8 7.2 5.7-2.9-1.9-6.5-2.7-10.1-2-2.7.5-4.7 1.5-6.4 3.1z" fill="currentColor" opacity=".45" />
          </>
        ) : isMale ? (
          <>
            <circle cx="24" cy="16.4" r="8" fill="currentColor" />
            <path d="M24 26.4c-6.8 0-12.3 4.5-13.6 10.5-.2 1.3.7 2.4 2 2.4h23.2c1.3 0 2.2-1.1 2-2.4-1.3-6-6.8-10.5-13.6-10.5z" fill="currentColor" />
          </>
        ) : (
          <>
            <circle cx="24" cy="16.8" r="8.2" fill="currentColor" />
            <path d="M24 26.8c-6.6 0-12 4.4-13.4 10.3-.3 1.3.7 2.5 2 2.5h22.8c1.3 0 2.3-1.2 2-2.5-1.4-5.9-6.8-10.3-13.4-10.3z" fill="currentColor" />
          </>
        )}
      </svg>
      {!isMale && !isFemale ? <i className="avatar-initial">{initial}</i> : null}
    </span>
  );
}
