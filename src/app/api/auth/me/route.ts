import { getSession } from '@/lib/auth'
import { withHandler } from '@/lib/api'

export const GET = withHandler(async () => {
  const session = await getSession()
  if (!session) return { user: null }
  return {
    user: session.user,
    session: {
      expiresAt: session.session.expiresAt,
      lastSeenAt: session.session.lastSeenAt,
    },
  }
})
