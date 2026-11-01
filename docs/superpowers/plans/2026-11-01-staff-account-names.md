# Staff Account Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Suggest consistent editable usernames and report names while retaining full names and old accounts.
**Architecture:** Pure shared name suggestions, backwards-compatible SQLite profile columns and typed API fields, then existing Users create/edit forms. Existing displayName flows to receipts/reports with no history rewrite.
**Tech Stack:** TypeScript, React, SQLite, tRPC, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-11-01-staff-account-names-design.md

## Global Constraints

No production writes or credentials. Keep old usernames, IDs, passwords and histories. Never transliterate Thai names into invented English. Username max30, ASCII letters/digits/._; lowercase suggestions. Preserve manual overrides when other name fields change. Keep full names separate from displayName.

## Review Focus

- Case-insensitive collisions and long English names must yield a valid available username.
- Thai leading vowels and compound surnames need readable initials.
- Empty English names permit manual usernames, with no fabricated transliteration.
- Old databases and older create/update clients retain names, usernames and password hashes.
- Editing names must not bypass self-role, last-admin, authorization or password rules.

### Task 1: Suggestions and stored profiles

Files: shared/userNames.ts, client/src/userNames.test.ts, shared/storeTypes/access.ts, server/sqliteStore.ts, server/routers.ts, server/userProfileNames.test.ts.
Interfaces: suggestUsername(englishName, existingUsernames), suggestReportName(fullName); optional fullName and englishName alongside displayName.
- [x] Write and run failing tests for suggestions, legacy migration, creation and editing, credential/ID preservation.
- [x] Implement pure suggestions and safe schema migration/profile validation. Keep passwords and username uniqueness unchanged.
- [x] Run targeted auth/user tests and TypeScript.

### Task 2: Create/edit flow and verification

Files: client/src/pages/Users.tsx; existing form styles only.
Interfaces: existing user.create/user.update with optional fullName/englishName; no account username rename.
- [x] Add ordered Thai/English names, editable suggested username and report name, and existing password/role fields.
- [x] Preserve manual overrides on edits; show full/display identities in account management and search.
- [x] Verify local mocked create/edit flows, collisions, override preservation and mobile layout with Playwright; no live user creation.
- [x] Run build/check, review diff, document evidence and commit on separate branch.
