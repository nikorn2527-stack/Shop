# Hospital Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the approved customer login design without changing production data.
**Architecture:** Keep the existing React LoginView auth logic and embedded image settings. Add a configurable loginOrganizationName through settings, public branding and cache, and scope all visual overrides to the login welcome screen.
**Tech Stack:** React, TypeScript, Vite, tRPC, SQLite, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-11-01-hospital-login-design.md

## Global Constraints

Keep original customer logo and appName. Use #65DC98 for the login submit. No production DB writes, deployment or shared-branch push. Preserve plain and uploaded-background modes and all auth flows. Do not put patient/member data or settings payloads into git.

## Review Focus

- Old cached branding without organization must remain readable.
- Long Thai organization names and 320px widths must wrap without horizontal overflow.
- Bad background images must fall back to a usable plain form.
- Password reveal, disabled submit and transfer confirmation must work as before.
- Name and background remain login-only; print/workspace settings unchanged.

### Task 1: Login branding and presentation

**Files:** shared/storeTypes/settings.ts; server/sqliteStore.ts; server/routers.ts; client/src/theme.ts; client/src/pages/settings/Settings.tsx; client/src/components/LoginView.tsx; client/src/styles/login-welcome.css; client/src/main.tsx.
**Interfaces:** optional BrandSettings.loginOrganizationName, persisted StoreSettings.loginOrganizationName string; original LoginView props unchanged.

- [x] Add failing persistence and cache tests for the organization setting, including old caches.
- [x] Add the bounded organization setting to validation/public branding, cache and settings UI.
- [x] Implement the approved heading, logo, card and footer in LoginView with scoped responsive CSS. Keep existing mutation handlers.
- [x] Run targeted tests and TypeScript/build.
- [x] Prepare optimized approved image and customer settings payload outside git. Render local login using real public customer branding with browser routes mocked; do not log in to production.
- [x] Verify desktop, 390px mobile, 320px mobile and short landscape; exercise reveal, error, successful submit, transfer confirmation and broken-image fallback. Inspect screenshots against concept.
- [x] Review diff, record evidence and retain branch for later deployment.
