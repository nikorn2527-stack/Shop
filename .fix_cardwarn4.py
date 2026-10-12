# -*- coding: utf-8 -*-
import io

path = "client/src/components/MemberRegistrationModal.tsx"
with io.open(path, "r", encoding="utf-8") as f:
    src = f.read()

start = src.index('<small>{member.reason === "citizenId"')
end = src.index('</small>', start) + len('</small>')

new_block = ('<small>{member.reason === "citizenId" ? "เลขบัตรประชาชนตรงกับสมาชิกนี้ จึงไม่สามารถสมัครซ้ำได้" '
             ': member.reason === "phone" ? "เบอร์โทรศัพท์ที่กรอกตรงกับสมาชิกนี้ หากใช้เบอร์ร่วมกันและเป็นคนละคน สามารถยืนยันสมัครใหม่ได้" '
             ': member.reason === "card" ? "รหัสบัตรซ้ำกับสมาชิกที่ลงทะเบียนไว้แล้ว กรุณาใช้บัญชีเดิม" '
             ': "ชื่อและนามสกุลที่กรอกตรงกับสมาชิกนี้ หากเป็นคนละคนที่ชื่อเหมือนกัน สามารถยืนยันสมัครใหม่ได้"}</small>')

src = src[:start] + new_block + src[end:]

with io.open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
