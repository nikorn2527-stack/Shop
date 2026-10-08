import { MemberCardActionsModal } from "@/components/MemberCardActionsModal";
import type { MemberLite, Role } from "@/pages/pageData";
export function LimitReductionModal({ member, onClose, onSuccess }: {
 member: MemberLite; role: Role; userName: string; onClose: () => void; onSuccess: (message: string) => void;
}) {
 return <MemberCardActionsModal memberNumber={member.memberNumber} onClose={onClose} onSuccess={() => onSuccess("ดำเนินการเรียบร้อยแล้ว")} />;
}
