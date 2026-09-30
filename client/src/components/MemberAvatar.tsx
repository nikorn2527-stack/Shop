/**
 * Member photo with gender-based fallback avatar.
 * The member card / pickers / confirm dialogs all share it so the cashier
 * can visually verify WHO they are about to charge — photo first, otherwise
 * a male / female silhouette from the gender field.
 *
 * FIX-8 (user) — when `rounded=false` (used by the wallet card), the fallback
 * renders as a portrait-oriented (3:4) ID-style photo: bigger head + visible
 * shoulders, light background, head-and-shoulders frame like a real ID photo.
 * Caller controls aspect via the parent container (e.g. .member-card-photo).
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
        className={`member-photo${rounded ? " round" : " id-portrait"}`}
        src={member.photoUrl}
        alt={`รูปสมาชิก${member.firstName ?? ""}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const isMale = gender === "ชาย";
  const isFemale = gender === "หญิง";
  // FIX-8 — ID-portrait fallback: bigger head + shoulders, light background,
  // looks more like a real person photo than the old tiny icon.
  // viewBox 48x60 (4:5 portrait) for proper ID photo aspect ratio.
  const portraitViewBox = !rounded;
  const svgW = portraitViewBox ? Math.round(size * 0.85) : Math.round(size * 0.72);
  const svgH = portraitViewBox ? Math.round(size * 1.06) : Math.round(size * 0.72);
  return (
    <span
      className={`member-photo-fallback ${isMale ? "male" : isFemale ? "female" : "neutral"}${rounded ? " round" : " id-portrait"}`}
      style={{ width: size, height: portraitViewBox ? Math.round(size * 1.25) : size }}
      role="img"
      aria-label={`ไม่มีรูปสมาชิก · ใช้รูป${gender === "ไม่ระบุ" ? "เริ่มต้น" : gender}`}
    >
      <svg viewBox={portraitViewBox ? "0 0 48 60" : "0 0 48 48"} width={svgW} height={svgH} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
        {portraitViewBox ? (
          // ID-portrait: head + shoulders + neck (looks like a real ID photo)
          isFemale ? (
            <>
              <rect x="0" y="0" width="48" height="60" fill="#f3f0ec" />
              {/* hair back (longer for female) */}
              <path d="M14 24 Q14 12 24 11 Q34 12 34 24 L34 36 Q34 38 32 38 L16 38 Q14 38 14 36 Z" fill="#5a4a3a" opacity=".7" />
              {/* neck */}
              <rect x="20" y="34" width="8" height="6" fill="#e8c4a0" />
              {/* shoulders/torso (blouse) */}
              <path d="M6 60 Q6 46 18 42 L30 42 Q42 46 42 60 Z" fill="#c9a8b3" />
              {/* head */}
              <ellipse cx="24" cy="22" rx="9" ry="10.5" fill="#f0c8a0" />
              {/* hair front (bangs) */}
              <path d="M15 18 Q15 12 24 11 Q33 12 33 18 L33 22 Q30 19 24 19 Q18 19 15 22 Z" fill="#5a4a3a" />
              {/* face features */}
              <circle cx="20" cy="22" r="0.9" fill="#3a2a20" />
              <circle cx="28" cy="22" r="0.9" fill="#3a2a20" />
              <path d="M22 27 Q24 28.5 26 27" stroke="#a0584a" strokeWidth="0.8" fill="none" strokeLinecap="round" />
            </>
          ) : isMale ? (
            <>
              <rect x="0" y="0" width="48" height="60" fill="#f3f0ec" />
              {/* neck */}
              <rect x="20" y="32" width="8" height="6" fill="#d8a878" />
              {/* shoulders/torso (shirt) */}
              <path d="M6 60 Q6 46 18 42 L30 42 Q42 46 42 60 Z" fill="#5a7286" />
              {/* head */}
              <ellipse cx="24" cy="22" rx="9" ry="10.5" fill="#e8b888" />
              {/* hair */}
              <path d="M15 19 Q15 11 24 10 Q33 11 33 19 L33 22 Q30 17 24 17 Q18 17 15 22 Z" fill="#2a1a10" />
              {/* face features */}
              <circle cx="20" cy="22" r="0.9" fill="#2a1a10" />
              <circle cx="28" cy="22" r="0.9" fill="#2a1a10" />
              <path d="M22 27 Q24 28 26 27" stroke="#804030" strokeWidth="0.8" fill="none" strokeLinecap="round" />
            </>
          ) : (
            <>
              <rect x="0" y="0" width="48" height="60" fill="#f3f0ec" />
              <rect x="20" y="32" width="8" height="6" fill="#d4a878" />
              <path d="M6 60 Q6 46 18 42 L30 42 Q42 46 42 60 Z" fill="#7a8a86" />
              <ellipse cx="24" cy="22" rx="9" ry="10.5" fill="#ddb488" />
              <path d="M15 19 Q15 12 24 11 Q33 12 33 19 L33 22 Q30 18 24 18 Q18 18 15 22 Z" fill="#3a2a20" />
              <circle cx="20" cy="22" r="0.9" fill="#2a1a10" />
              <circle cx="28" cy="22" r="0.9" fill="#2a1a10" />
              <path d="M22 27 Q24 28 26 27" stroke="#704030" strokeWidth="0.8" fill="none" strokeLinecap="round" />
            </>
          )
        ) : isFemale ? (
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
      {!isMale && !isFemale && !portraitViewBox ? <i className="avatar-initial">{initial}</i> : null}
    </span>
  );
}
