import type { MemberSlipDocument } from "@shared/storeTypes/documents";
import { memberSlipReceipt, memberSlipLabels } from "@/lib/memberSlipReceipt";
import { ReceiptModal } from "./ReceiptModal";

export function MemberTransactionSlip({
  document,
  onClose,
  mode = "new",
}: {
  document: MemberSlipDocument;
  onClose: () => void;
  mode?: "new" | "reprint";
}) {
  return (
    <ReceiptModal
      receipt={memberSlipReceipt(document)}
      transaction={document}
      documentTitle={memberSlipLabels(document).title}
      onClose={onClose}
      mode={mode}
    />
  );
}
