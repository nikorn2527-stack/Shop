import { withHandler } from '@/lib/api'

/** Liveness + readiness probe for Docker healthcheck. */
export const GET = withHandler(async () => {
  return {
    ok: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
  }
})
