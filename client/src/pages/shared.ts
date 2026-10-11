/**
 * Shared types and constants used across the V2 refactored Home.tsx — kept here so
 * that the AppShell layout (`client/src/layouts/AppShell.tsx`) and the view
 * components that still live inside `Home.tsx` (Members / Reports / Settings /
 * Logs) can both import the same definitions without a circular import.
 *
 * Step V2-B (AppShell extraction) only moved `SettingsTab` here; more shared
 * types will land in this file as subsequent V2 steps extract more views.
 */

/**
 * Settings view tabs. Mirrors the `tabs` array rendered inside the Settings
 * component (Home.tsx) and the value AppShell tracks when the sidebar
 * "เวอร์ชันและลิขสิทธิ์" pill is clicked (`settingsFocusTab`).
 */
export type SettingsTab =
  | "install"
  | "brand"
  | "receipt"
  | "member"
  | "payment"
  | "posmenu"
  | "cutoff"
  | "edition"
  | "import"
  | "backup"
  | "network"
  | "display"
  | "alert"
  | "roles";
