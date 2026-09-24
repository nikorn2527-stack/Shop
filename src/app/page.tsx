/**
 * Root page — Server-Component auth gate.
 *
 * Decision tree (top → bottom, first match wins):
 *   1. db.user.count() === 0          → SetupView      (first-run setup)
 *   2. getSession() returns null       → LoginView      (no active session)
 *   3. session.user.mustChangePassword → ForceChangeView
 *   4. otherwise                       → AppShell       (placeholder dashboard)
 *
 * The 3 auth views and the AppShell are client components imported here. This
 * page itself uses NO hooks — only direct DB / getSession() calls — so it can
 * be a pure Server Component.
 *
 * `dynamic = 'force-dynamic'` keeps the gate fresh on every request so that
 * POST /api/auth/login (which sets the cookie) is immediately visible when we
 * call router.refresh() from the client side.
 */

import { Suspense } from "react";
import { db } from "@/lib/db";
import { getSession, type SessionUser } from "@/lib/auth";
import LoginView from "@/components/auth/LoginView";
import SetupView from "@/components/auth/SetupView";
import ForceChangeView from "@/components/auth/ForceChangeView";
import AppShell from "@/components/auth/AppShell";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Step 1 — first-run setup detection.
  const userCount = await db.user.count();
  if (userCount === 0) {
    return (
      <Suspense fallback={null}>
        <SetupView />
      </Suspense>
    );
  }

  // Step 2 — active session lookup (reads cookie).
  const session = await getSession();
  if (!session) {
    return (
      <Suspense fallback={null}>
        <LoginView />
      </Suspense>
    );
  }

  // Step 3 — forced password change (first-run setup OR admin-issued temp pw).
  const user: SessionUser = session.user;
  if (user.mustChangePassword) {
    return (
      <Suspense fallback={null}>
        <ForceChangeView user={user} />
      </Suspense>
    );
  }

  // Step 4 — authenticated, ready for the dashboard.
  return (
    <Suspense fallback={null}>
      <AppShell user={user} />
    </Suspense>
  );
}
