'use client'

/**
 * RegisterMemberModal — quick member registration at POS (F6).
 *
 * Mirror of /tmp/Shop/client/src/pages/Pos.tsx register flow, adapted to
 * react-hook-form + zod + shadcn/ui form components.
 *
 * On submit: POST /api/members/new → on success the parent shows the
 * MemberCardModal + attaches the new memberNumber to the current bill.
 *
 * Note: the registration endpoint actually lives at `/api/members/[number]`
 * (the [number] param is ignored for POST). `/api/members/new` is a stable
 * URL that hits the same handler.
 */

import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { IdCard, ImagePlus, Loader2, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiPost } from '@/lib/api-client'
import { compressImageToDataUrl, PRENAME_OPTIONS } from '@/lib/scan'

const Schema = z.object({
  prename: z.string().max(20).optional(),
  firstName: z.string().min(1, 'กรุณาระบุชื่อ').max(100),
  lastName: z.string().min(1, 'กรุณาระบุนามสกุล').max(100),
  idCard: z.string().max(20).optional(),
  phone: z.string().max(20).optional(),
  type: z.string().max(40),
  gender: z.enum(['ชาย', 'หญิง', 'ไม่ระบุ']),
  cardNumber: z.string().max(20).optional(),
  patientCode: z.string().max(20).optional(),
  memberNumber: z.string().max(40).optional(),
  initialDeposit: z.string().optional(),
})

type FormValues = z.infer<typeof Schema>

export interface RegisterMemberResult {
  member: {
    id: string
    memberNumber: string
    prename: string | null
    firstName: string
    lastName: string
    type: string
    balance: number
    status: string
    createdAt: string
    photoUrl: string | null
    gender: string | null
    cardNumber: string | null
    patientCode: string | null
  }
}

export interface RegisterMemberModalProps {
  open: boolean
  onClose: () => void
  onRegistered: (result: RegisterMemberResult) => void
}

const TYPE_OPTIONS = ['สมาชิก', 'เจ้าหน้าที่', 'ผู้ป่วยใน', 'ผู้ป่วยนอก', 'บุคลากร']

export function RegisterMemberModal({ open, onClose, onRegistered }: RegisterMemberModalProps) {
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const [pending, setPending] = useState(false)
  const photoInputRef = useRef<HTMLInputElement | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      prename: '',
      firstName: '',
      lastName: '',
      idCard: '',
      phone: '',
      type: 'สมาชิก',
      gender: 'ไม่ระบุ',
      cardNumber: '',
      patientCode: '',
      memberNumber: '',
      initialDeposit: '',
    },
  })

  const { register, handleSubmit, formState, reset } = form

  const onPhotoPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.error('รองรับเฉพาะไฟล์รูป PNG JPG WEBP')
      return
    }
    if (file.size > 8_000_000) {
      toast.error('ไฟล์รูปใหญ่เกิน 8MB', { description: 'ย่อขนาดรูปหรือเลือกไฟล์เล็กลง' })
      return
    }
    setPhotoBusy(true)
    compressImageToDataUrl(file, 480, 0.72)
      .then((url) => {
        setPhotoUrl(url)
      })
      .catch(() => {
        toast.error('อ่านไฟล์รูปไม่สำเร็จ', { description: 'ลองเลือกไฟล์ใหม่' })
      })
      .finally(() => setPhotoBusy(false))
  }

  const onSubmit = async (values: FormValues) => {
    const initialDeposit = (values.initialDeposit ?? '').trim()
    const initialDepositNum = initialDeposit === '' ? undefined : Number(initialDeposit)
    if (initialDepositNum !== undefined && !(initialDepositNum > 0)) {
      toast.error('เงินเริ่มต้นต้องมากกว่า 0', { description: 'เว้นว่างไว้หากยังไม่เติมเงิน' })
      return
    }
    setPending(true)
    try {
      const result = await apiPost<RegisterMemberResult>('/api/members/new', {
        prename: values.prename?.trim() || null,
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        idCard: values.idCard?.trim() || null,
        phone: values.phone?.trim() || null,
        type: values.type,
        gender: values.gender === 'ไม่ระบุ' ? null : values.gender,
        photoUrl: photoUrl || null,
        memberNumber: values.memberNumber?.trim() || undefined,
        initialDeposit: initialDepositNum,
        cardNumber: values.cardNumber?.trim() || null,
        patientCode: values.patientCode?.trim() || null,
      })
      reset()
      setPhotoUrl('')
      onRegistered(result)
    } catch (err) {
      toast.error('ลงทะเบียนไม่สำเร็จ', {
        description: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดบางอย่าง',
      })
    } finally {
      setPending(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
      role="presentation"
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-lg rounded-2xl bg-card shadow-2xl overflow-hidden my-auto"
        role="dialog"
        aria-modal="true"
        aria-label="ลงทะเบียนสมาชิกใหม่"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b">
          <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 size-9 rounded-lg bg-emerald-100 text-emerald-700 grid place-items-center">
              <UserPlus size={18} />
            </span>
            <div className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                Quick Register
              </span>
              <h2 className="text-base font-semibold truncate">ลงทะเบียนสมาชิกใหม่</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="shrink-0 size-8 rounded-lg text-muted-foreground hover:bg-muted grid place-items-center"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Photo upload */}
          <div className="flex items-center gap-4">
            <div className="shrink-0 size-20 rounded-xl overflow-hidden bg-muted grid place-items-center border">
              {photoUrl ? (
                <img src={photoUrl} alt="รูปสมาชิก" className="w-full h-full object-cover" />
              ) : photoBusy ? (
                <Loader2 size={20} className="animate-spin text-muted-foreground" />
              ) : (
                <IdCard size={28} className="text-muted-foreground" />
              )}
            </div>
            <div className="flex-1">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={onPhotoPick}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={photoBusy}
                onClick={() => photoInputRef.current?.click()}
              >
                <ImagePlus size={14} />
                {photoBusy ? 'กำลังย่อรูป...' : photoUrl ? 'เปลี่ยนรูป' : 'เพิ่มรูปสมาชิก'}
              </Button>
              <p className="text-[11px] text-muted-foreground mt-1">
                ย่ออัตโนมัติ 480px JPEG (สูงสุด 8MB · PNG/JPG/WEBP)
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="prename" className="text-xs">คำนำหน้า</Label>
              <Input
                id="prename"
                list="prename-options"
                placeholder="นาย / นางสาว"
                className="h-9"
                {...register('prename')}
              />
              <datalist id="prename-options">
                {PRENAME_OPTIONS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="firstName" className="text-xs">ชื่อ <span className="text-red-600">*</span></Label>
              <Input
                id="firstName"
                placeholder="สมหญิง"
                className="h-9"
                autoComplete="off"
                {...register('firstName')}
              />
              {formState.errors.firstName && (
                <p className="text-[11px] text-red-600">{formState.errors.firstName.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lastName" className="text-xs">นามสกุล <span className="text-red-600">*</span></Label>
              <Input
                id="lastName"
                placeholder="มั่นคง"
                className="h-9"
                autoComplete="off"
                {...register('lastName')}
              />
              {formState.errors.lastName && (
                <p className="text-[11px] text-red-600">{formState.errors.lastName.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="type" className="text-xs">ประเภทสมาชิก</Label>
              <Input
                id="type"
                list="type-options"
                defaultValue="สมาชิก"
                className="h-9"
                {...register('type')}
              />
              <datalist id="type-options">
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="idCard" className="text-xs">เลขบัตรประชาชน</Label>
              <Input
                id="idCard"
                inputMode="numeric"
                placeholder="x-xxxx-xxxxx-xx-x"
                className="h-9"
                autoComplete="off"
                {...register('idCard')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone" className="text-xs">เบอร์โทร</Label>
              <Input
                id="phone"
                inputMode="tel"
                placeholder="08x-xxx-xxxx"
                className="h-9"
                autoComplete="off"
                {...register('phone')}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="gender" className="text-xs">เพศ</Label>
              <select
                id="gender"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                {...register('gender')}
              >
                <option value="ไม่ระบุ">ไม่ระบุ</option>
                <option value="ชาย">ชาย</option>
                <option value="หญิง">หญิง</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cardNumber" className="text-xs">รหัสบัตรเงินสด</Label>
              <Input
                id="cardNumber"
                placeholder="CR-xxxx"
                className="h-9"
                autoComplete="off"
                {...register('cardNumber')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="patientCode" className="text-xs">HN ผู้ป่วย</Label>
              <Input
                id="patientCode"
                placeholder="HN-xxxx"
                className="h-9"
                autoComplete="off"
                {...register('patientCode')}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="memberNumber" className="text-xs">หมายเลขสมาชิก</Label>
              <Input
                id="memberNumber"
                placeholder="ระบบกำหนดให้อัตโนมัติ"
                className="h-9"
                autoComplete="off"
                {...register('memberNumber')}
              />
              <p className="text-[11px] text-muted-foreground">เว้นว่างเพื่อให้ระบบออกหมายเลขให้</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="initialDeposit" className="text-xs">เงินเริ่มต้น (บาท)</Label>
              <Input
                id="initialDeposit"
                inputMode="decimal"
                placeholder="0.00"
                className="h-9"
                autoComplete="off"
                {...register('initialDeposit')}
              />
              <p className="text-[11px] text-muted-foreground">เติมเงินครั้งแรก (เว้นว่าง = ยังไม่เติม)</p>
            </div>
          </div>
        </div>

        <div className="p-5 border-t flex gap-2">
          <Button type="button" variant="outline" className="flex-1 h-10" onClick={onClose} disabled={pending}>
            ยกเลิก
          </Button>
          <Button
            type="submit"
            className="flex-1 h-10 bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={pending || photoBusy}
          >
            {pending ? (
              <>
                <Loader2 size={16} className="animate-spin" /> กำลังบันทึก...
              </>
            ) : (
              <>
                <UserPlus size={16} /> ลงทะเบียน + พิมพ์บัตร
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
