import type { ButtonHTMLAttributes } from "react";
import "./RowActionButton.css";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title" | "aria-label" | "type"> & {
  label: string;
  tone?: "default" | "danger" | "success";
};

export function RowActionButton({label,tone="default",className="",...props}:Props) {
  return <button {...props} type="button" className={`icon-button row-action-icon ${className}`} title={label} aria-label={label} data-row-action-tone={tone} />;
}
