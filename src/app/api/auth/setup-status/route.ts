import { db } from '@/lib/db'
import { ensureSystemSeed } from '@/lib/auth'
import { withHandler } from '@/lib/api'

export const GET = withHandler(async () => {
  await ensureSystemSeed()
  const userCount = await db.user.count()
  return { needsSetup: userCount === 0 }
})
