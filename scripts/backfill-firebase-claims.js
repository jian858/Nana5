"use strict";

/*
 * One-time trusted operator script for existing Murmur Firebase accounts.
 *
 * Run from a secure workstation after installing functions dependencies:
 *   GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json node scripts/backfill-firebase-claims.js
 *
 * The service-account file must never be committed or uploaded to Vercel.
 * This script preserves existing custom claims and only adds role=authenticated.
 */

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

initializeApp({ credential: applicationDefault() });

async function main() {
  const auth = getAuth();
  let pageToken;
  let updated = 0;
  let unchanged = 0;

  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      const claims = user.customClaims || {};
      if (claims.role === "authenticated") {
        unchanged += 1;
        continue;
      }
      await auth.setCustomUserClaims(user.uid, {
        ...claims,
        role: "authenticated"
      });
      updated += 1;
    }
    pageToken = page.pageToken;
  } while (pageToken);

  process.stdout.write(JSON.stringify({ updated, unchanged }) + "\n");
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack || error) + "\n");
  process.exitCode = 1;
});
