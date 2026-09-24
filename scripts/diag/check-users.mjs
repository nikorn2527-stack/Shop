// Check users + create testadmin (workaround for PowerShell $ escaping)
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()

console.log('=== 1. Current users in DB ===')
const users = await db.user.findMany({
  select: { username: true, role: true, active: true, mustChangePassword: true, passwordHash: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
})
users.forEach(u => {
  const hashFormat = u.passwordHash.startsWith('scrypt') ? 'scrypt(legacy)'
    : u.passwordHash.startsWith('$2a') || u.passwordHash.startsWith('$2b') ? 'bcrypt(new)'
    : 'unknown'
  console.log(`  ${u.username.padEnd(15)} ${u.role.padEnd(15)} ${u.active ? 'active' : 'inactive'} must-change=${u.mustChangePassword} hash=${hashFormat}`)
})

console.log()
console.log('=== 2. Create testadmin (password: TestPass@1234) ===')
try {
  const existing = await db.user.findUnique({ where: { username: 'testadmin' } })
  if (existing) {
    console.log('  testadmin already exists — skipping creation')
  } else {
    const u = await db.user.create({
      data: {
        username: 'testadmin',
        passwordHash: bcrypt.hashSync('TestPass@1234', 10),
        displayName: 'Test Admin',
        role: 'administrator',
        mustChangePassword: false,
        active: true,
      },
    })
    console.log('  OK created testadmin (id:', u.id, ')')
    console.log('  → Try login with: testadmin / TestPass@1234')
  }
} catch (e) {
  console.error('  Error creating testadmin:', e.message)
}

console.log()
console.log('=== 3. Test dual password verify ===')
const { verifyPasswordDual, needsRehash } = await import('../../src/lib/password-legacy.ts')

// Test with first user's hash (legacy scrypt from customer DB)
if (users.length > 0) {
  const first = users[0]
  console.log(`  Testing with ${first.username}'s hash (${first.passwordHash.slice(0, 20)}...)`)
  console.log('  needsRehash?', needsRehash(first.passwordHash) ? 'YES (will auto-upgrade on login)' : 'NO')
  console.log('  → Try login with customer\'s real password to test scrypt verify')
}

await db.$disconnect()
console.log()
console.log('Done.')
