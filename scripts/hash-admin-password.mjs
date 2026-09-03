#!/usr/bin/env node
/**
 * Generates the two environment variables that protect the admin dashboard.
 *
 *   node scripts/hash-admin-password.mjs "your chosen password"
 *
 * Prints RAJ_KUTHIR_ADMIN_PASSWORD_HASH and RAJ_KUTHIR_SESSION_SECRET ready to
 * paste into your host's variables panel. The plain password is never stored
 * anywhere — only its scrypt hash — so if you forget it, generate a new pair.
 *
 * Rotating RAJ_KUTHIR_SESSION_SECRET immediately signs out every existing
 * session, which is the fastest way to revoke access.
 */
import crypto from "node:crypto";

const password = process.argv[2];

if (!password) {
  console.error(
    'Usage: node scripts/hash-admin-password.mjs "your chosen password"',
  );
  process.exit(1);
}

if (password.length < 12) {
  console.error(
    `Refusing to hash a ${password.length}-character password. Use at least 12 characters — this is the only lock on your booking calendar.`,
  );
  process.exit(1);
}

const KEYLEN = 64;
const salt = crypto.randomBytes(16);

const derived = crypto.scryptSync(password, salt, KEYLEN);
const sessionSecret = crypto.randomBytes(32).toString("hex");

console.log("");
console.log("Add these to your host's environment variables:");
console.log("");
console.log(
  `RAJ_KUTHIR_ADMIN_PASSWORD_HASH=scrypt$${salt.toString("hex")}$${derived.toString("hex")}`,
);
console.log(`RAJ_KUTHIR_SESSION_SECRET=${sessionSecret}`);
console.log("");
console.log(
  "Keep your password in a password manager. It cannot be recovered from the hash.",
);
console.log("");
