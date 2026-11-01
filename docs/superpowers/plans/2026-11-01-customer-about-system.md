# Customer About System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove package/trial flows and keep agreed functions across cloud and self-hosted deployment.
**Architecture:** Existing managed edition status for all supported release channels; existing security flags remain independent. Shared commercial widgets become inert compatibility exports. Replace old edition settings surface with About using server health version.
**Tech Stack:** React, TypeScript, tRPC, SQLite, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-11-01-customer-about-system-design.md

## Global Constraints

No business-data imports/deletions or password resets. No commercial expiration. Preserve RBAC, authentication and Windows POS registration/password policy. Keep old licensing values without enforcing them.

## Review Focus

- Old expired/invalid keys must not lock agreed features or user counts.
- Moving cloud to Windows must keep all features while restoring Windows security flags.
- Initial setup and delayed queries must not flash package selections.
- Old settings tab links and feature-page upgrade callers must remain safe.
- Version displayed in About must reflect the running server, and full account/business history must stay intact.

### Task 1: Policy and customer surfaces

Files: server/runtimePolicy.ts/tests, server/license.test.ts, client/src/components/EditionUi.tsx, client/src/components/SetupView.tsx, client/src/pages/settings/Settings.tsx.
- [x] Pin managed feature parity across release channels with failing policy tests.
- [x] Disable edition enforcement without changing other channel policies; update obsolete tier-enforcement assertions to the new customer contract.
- [x] Remove package/key/trial UI and replace settings with About, retaining internal tab compatibility.
- [x] Run focused licensing/auth/permission tests, TypeScript/build, and mocked desktop/mobile About verification.
- [ ] Publish tested commit to authorized existing Railway main, verify deployment status, public assets and health; keep all real-data imports deferred.
