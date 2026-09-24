// Diagnostic + fix script for login issues
// Run: node scripts/diag/fix-login.mjs
//
// This script:
// 1. Lists all users + their hash format
// 2. Verifies each user's hash (without password)
// 3. Recreates testadmin with a known bcrypt hash (TestPass@1234)
// 4. Tests login API endpoint directly
// 5. Reports what's wrong

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { verifyPasswordDual, hashPasswordBcrypt } from '../../src/lib/password-legacy.ts'

const db = new PrismaClient()

console.log('=== 1. All users in DB ===')
const users = await db.user.findMany({
  select: {
    id: true, username: true, role: true, active: true,
    mustChangePassword: true, failedAttempts: true, lockedUntil: true,
    passwordHash: true, createdAt: true,
  },
  orderBy: { createdAt: 'asc' },
})

for (const u of users) {
  const hashFormat = u.passwordHash.startsWith('scrypt') ? 'scrypt(legacy)'
    : u.passwordHash.startsWith('$2a') || u.passwordHash.startsWith('$2b') ? 'bcrypt(new)'
    : 'unknown'
  const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date()
  console.log(`  ${u.username.padEnd(15)} ${u.role.padEnd(15)} ${u.active ? 'active' : 'INACTIVE'} ${u.mustChangePassword ? 'must-change' : 'ok'} failed=${u.failedAttempts}${locked ? ' LOCKED' : ''} hash=${hashFormat}`)
}

console.log()
console.log('=== 2. Recreate testadmin with known bcrypt hash (TestPass@1234) ===')
await db.user.upsert({
  where: { username: 'testadmin' },
  update: {
    passwordHash: hashPasswordBcrypt('TestPass@1234'),
    active: true,
    mustChangePassword: false,
    failedAttempts: 0,
    lockedUntil: null,
  },
  create: {
    username: 'testadmin',
    passwordHash: hashPasswordBcrypt('TestPass@1234'),
    displayName: 'Test Admin',
    role: 'administrator',
    mustChangePassword: false,
    active: true,
  },
})

const testadmin = await db.user.findUnique({ where: { username: 'testadmin' } })
console.log(`  Recreated. Hash: ${testadmin.passwordHash.slice(0, 30)}...`)

console.log()
console.log('=== 3. Verify password directly (bypass server) ===')
console.log('  verifyPasswordDual("TestPass@1234"):', verifyPasswordDual('TestPass@1234', testadmin.passwordHash))
console.log('  bcrypt.compareSync("TestPass@1234"):', bcrypt.compareSync('TestPass@1234', testadmin.passwordHash))

console.log()
console.log('=== 4. Test login API endpoint directly ===')
try {
  const res = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testadmin', password: 'TestPass@1234' }),
  })
  const body = await res.text()
  console.log(`  HTTP Status: ${res.status}`)
  console.log(`  Response: ${body.slice(0, 500)}`)
  if (res.ok) {
    console.log('  → LOGIN WORKS! Try in browser now.')
  } else {
    console.log('  → LOGIN FAILS — see error above')
  }
} catch (e) {
  console.log(`  Fetch error: ${e.message}`)
  console.log('  → Dev server not running on http://localhost:3000?')
  console.log('  → Run: bun run dev')
}

console.log()
console.log('=== 5. If login still fails, possible causes ===')
console.log('  a) testadmin not in DB — recreate with this script')
console.log('  b) testadmin locked (failedAttempts >= 5) — script resets to 0')
console.log('  c) testadmin inactive — script sets active=true')
console.log('  d) Dev server not restarted after code changes — restart with: bun run dev')
console.log('  e) Browser cache — hard refresh with Ctrl+Shift+R')
console.log('  f) Cookie not being set — check browser DevTools > Application > Cookies')

await db.$disconnect()
console.log()
console.log('Done.')
