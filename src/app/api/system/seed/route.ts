import { db } from '@/lib/db'
import { ensureSystemSeed } from '@/lib/auth'
import { withHandler } from '@/lib/api'

/** Manually trigger system seed (dev helper — also runs automatically on setup-status). */
export const POST = withHandler(async () => {
  await ensureSystemSeed()
  const [users, roles, perms, wh] = await Promise.all([
    db.user.count(),
    db.role.count(),
    db.permission.count(),
    db.warehouse.count(),
  ])
  return { users, roles, perms, warehouses: wh }
})
