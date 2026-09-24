import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, StoreError } from '@/lib/api'
import { NotFoundError, ConflictError, StoreError as StoreErr } from '@/lib/errors'
import { nextMemberNumber } from '@/lib/stock'
import { getSettings } from '@/lib/auth'
import { round2 } from '@/lib/format'
import { validateImageDataUrl } from '@/lib/scan'

const Body = z.object({
  prename: z.string().max(20).nullable().optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  idCard: z.string().max(20).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  type: z.string().max(40).optional(),
  gender: z.string().max(20).nullable().optional(),
  photoUrl: z.string().max(600_000).nullable().optional(),
  creditLimit: z.number().min(0).max(1_000_000).nullable().optional(),
  cardNumber: z.string().max(20).nullable().optional(),
  patientCode: z.string().max(20).nullable().optional(),
  memberNumber: z.string().max(40).optional(), // for manual mode
  initialDeposit: z.number().min(0).optional(),
})

export async function POST(req: NextRequest) {
  // Reuse withAuth via the standard wrapper for body parsing + permission gate
  const { withAuth, StoreError: SError } = await import('@/lib/api')
  return withAuth(async (request, ctx) => {
    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) throw new SError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')

    const settings = await getSettings()
    const memberNumber = parsed.data.memberNumber?.trim()
      || await nextMemberNumber(
        settings.memberNumberMode as 'running' | 'year' | 'manual',
        {
          prefix: settings.memberNumberPrefix,
          yearMode: settings.memberNumberYearMode as 'none' | 'buddhist' | 'gregorian',
          yearDigits: settings.memberNumberYearDigits as 2 | 4,
          resetMonth: settings.memberNumberResetMonth,
          sequenceDigits: settings.memberNumberSequenceDigits,
          separator: settings.memberNumberSeparator as '-' | '/' | '_' | '',
        },
        parsed.data.memberNumber,
      )
    if (!memberNumber) throw new SError('ไม่สามารถสร้างเลขสมาชิกได้ · ลองตั้งค่ารูปแบบเลขสมาชิกใหม่')

    // Check uniqueness
    const existing = await db.member.findUnique({ where: { memberNumber } })
    if (existing) throw new ConflictError(`หมายเลขสมาชิก ${memberNumber} ถูกใช้แล้ว`)

    // Validate card number uniqueness
    if (parsed.data.cardNumber) {
      const existingCard = await db.member.findFirst({ where: { cardNumber: parsed.data.cardNumber } })
      if (existingCard) throw new ConflictError(`รหัสบัตร ${parsed.data.cardNumber} ถูกใช้กับสมาชิก ${existingCard.memberNumber} แล้ว`)
    }
    if (parsed.data.patientCode) {
      const existingHn = await db.member.findFirst({ where: { patientCode: parsed.data.patientCode } })
      if (existingHn) throw new ConflictError(`HN ${parsed.data.patientCode} ถูกใช้กับสมาชิก ${existingHn.memberNumber} แล้ว`)
    }

    const photoUrl = validateImageDataUrl(parsed.data.photoUrl ?? null)
    const initialDeposit = round2(parsed.data.initialDeposit ?? 0)

    const result = await db.$transaction(async (tx) => {
      const member = await tx.member.create({
        data: {
          memberNumber,
          prename: parsed.data.prename ?? null,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          idCard: parsed.data.idCard ?? null,
          phone: parsed.data.phone ?? null,
          type: parsed.data.type ?? 'สมาชิก',
          balance: 0, // initial deposit via member_transaction below
          status: 'active',
          photoUrl,
          gender: parsed.data.gender ?? null,
          creditLimit: parsed.data.creditLimit ?? null,
          cardNumber: parsed.data.cardNumber ?? null,
          patientCode: parsed.data.patientCode ?? null,
        },
      })

      if (initialDeposit > 0) {
        await tx.member.update({
          where: { id: member.id },
          data: { balance: initialDeposit },
        })
        await tx.memberTransaction.create({
          data: {
            memberNumber: member.memberNumber,
            type: 'activation',
            detail: `เปิดบัญชี · เติมเงินครั้งแรก ฿${initialDeposit.toFixed(2)}`,
            amount: initialDeposit,
            balanceAfter: initialDeposit,
            paymentMethod: 'เงินสด',
            actor: ctx.displayName,
          },
        })
      }

      await tx.auditLog.create({
        data: {
          action: 'ลงทะเบียนสมาชิก',
          actorId: ctx.userId,
          actor: ctx.displayName,
          actorRole: ctx.role,
          entity: 'member',
          entityId: member.id,
          detail: `${member.memberNumber} · ${member.firstName} ${member.lastName}${initialDeposit > 0 ? ` · เติมเงินครั้งแรก ฿${initialDeposit.toFixed(2)}` : ''}`,
          tone: 'blue',
        },
      })

      return member
    })

    return { member: result }
  }, 'MEMBER.EDIT')(req)
}

type Ctx = { params: Promise<{ number: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const { number: memberNumber } = await params
  const { withAuth } = await import('@/lib/api')
  return withAuth(async () => {
    const member = await db.member.findUnique({ where: { memberNumber } })
    if (!member) throw new NotFoundError('ไม่พบสมาชิก')

    const transactions = await db.memberTransaction.findMany({
      where: { memberNumber },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    const limitRequests = await db.limitRequest.findMany({
      where: { memberNumber },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    // Lifetime stats
    const sales = await db.sale.findMany({
      where: { memberNumber, voided: false },
      select: { total: true, createdAt: true, items: { select: { name: true, qty: true } } },
    })
    const totalSpent = round2(sales.reduce((s, x) => s + x.total, 0))
    const itemCountMap = new Map<string, number>()
    for (const s of sales) {
      for (const it of s.items) {
        itemCountMap.set(it.name, (itemCountMap.get(it.name) ?? 0) + it.qty)
      }
    }
    const topProducts = [...itemCountMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)

    return {
      member,
      transactions,
      limitRequests,
      stats: {
        totalSpent,
        billCount: sales.length,
        topProducts,
      },
    }
  }, 'MEMBER.VIEW')(req)
}

export const dynamic = 'force-dynamic'
