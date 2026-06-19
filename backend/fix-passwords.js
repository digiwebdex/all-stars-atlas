// Run once to update seeded user passwords with correct bcrypt hashes
// Usage: node fix-passwords.js

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./src/config/db');

async function fix() {
  try {
    // Admin password: Admin@123456
    const adminHash = await bcrypt.hash('Admin@123456', 12);
    await db.query('UPDATE users SET password_hash = ? WHERE email = ?', [adminHash, 'admin@seventrip.net']);
    console.log('✅ Admin password updated');

    // User password: User@123456
    const userHash = await bcrypt.hash('User@123456', 12);
    await db.query('UPDATE users SET password_hash = ? WHERE email = ?', [userHash, 'rahim@gmail.com']);
    console.log('✅ User password updated');

    console.log('\n🔑 Credentials:');
    console.log('   Admin: admin@seventrip.net / Admin@123456');
    console.log('   User:  rahim@gmail.com / User@123456');

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

fix();
