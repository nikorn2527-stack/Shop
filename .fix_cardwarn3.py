# -*- coding: utf-8 -*-
import io

path = "client/src/components/MemberRegistrationModal.tsx"
with io.open(path, "r", encoding="utf-8") as f:
    src = f.read()

old = '"ชื่อและนามสกุลที่กรอกตรงกับสมาชิกนี้ หากเป็นคนละคนที่ชื่อเหมือนกัน สามารถยืนยันสมัครใหม่ได้"'

new = ('member.reason === "card" ? "รหัสบัตรซ้ำกับสมาชิกที่ลงทะเบียนไว้แล้ว กรุณาใช้บัญชีเดิม" '
       ': "ชื่อและนามสกุลที่กรอกตรงกับสมาชิกนี้ หากเป็นคนละคนที่ชื่อเหมือนกัน สามารถยืนยันสมัครใหม่ได้"')

assert src.count(old) == 1, src.count(old)
src = src.replace(old, new)

with io.open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
