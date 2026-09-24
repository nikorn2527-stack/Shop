import { db } from '@/lib/db'
import { withHandler } from '@/lib/api'

export const GET = withHandler(async () => {
  // Application version — read from package.json at build time.
  // Override via env APP_VERSION for CI/CD pipelines.
  const version = process.env.APP_VERSION || '1.0.0-dev'
  const buildDate = process.env.APP_BUILD_DATE || null
  const commitSha = process.env.APP_COMMIT_SHA || null

  // Database size + uptime info (for health / System Update page).
  let dbInfo: { userCount: number; memberCount: number; productCount: number; saleCount: number; dbSizeBytes: number | null } = {
    userCount: 0,
    memberCount: 0,
    productCount: 0,
    saleCount: 0,
    dbSizeBytes: null,
  }
  try {
    const [users, members, products, sales] = await Promise.all([
      db.user.count(),
      db.member.count(),
      db.product.count(),
      db.sale.count(),
    ])
    dbInfo = { userCount: users, memberCount: members, productCount: products, saleCount: sales, dbSizeBytes: null }
  } catch {
    // DB not yet migrated — return zeros.
  }

  // Latest SystemVersion row (if any migrations applied)
  let appliedVersion: { version: string; appliedAt: Date; status: string } | null = null
  try {
    const v = await db.systemVersion.findFirst({ orderBy: { appliedAt: 'desc' } })
    if (v) appliedVersion = { version: v.version, appliedAt: v.appliedAt, status: v.status }
  } catch {
    // SystemVersion table not yet created — skip.
  }

  return {
    ok: true,
    version,
    buildDate,
    commitSha,
    appliedVersion,
    nodeEnv: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
    db: dbInfo,
  }
})
