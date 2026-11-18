"use strict";

const functions = require("firebase-functions/v1");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

initializeApp();

/**
 * Supabase Third-Party Auth requires role=authenticated on Firebase ID tokens.
 * Preserve every existing custom claim; only set the required role claim.
 *
 * This trigger runs for newly created Firebase users. Existing users must be
 * updated with scripts/backfill-firebase-claims.js using trusted Admin SDK
 * credentials. Never run Admin SDK code in the browser.
 */
exports.setSupabaseAuthenticatedRole = functions.auth.user().onCreate(async (user) => {
  const auth = getAuth();
  const current = await auth.getUser(user.uid);
  const claims = current.customClaims || {};

  if (claims.role === "authenticated") return null;

  await auth.setCustomUserClaims(user.uid, {
    ...claims,
    role: "authenticated"
  });

  return null;
});
