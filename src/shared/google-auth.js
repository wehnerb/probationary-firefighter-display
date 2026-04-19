// ============================================================
// google-auth.js — Google Service Account JWT authentication
// Fargo Fire Department station display Workers
//
// SOURCE OF TRUTH: ffd-station-display-utils repo
// Do not edit the copy in any Worker's src/shared/ directory —
// it will be overwritten on the next sync.
//
// Generates a short-lived Google OAuth2 access token from
// service account credentials stored as Worker secrets.
// Uses RSA-SHA256 JWT signing via the Web Crypto API built
// into Cloudflare Workers — no external dependencies required.
//
// Required Worker secrets:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL — service account email
//   GOOGLE_PRIVATE_KEY           — RSA private key from
//                                  Google Cloud JSON key file
//
// Usage:
//   import { getAccessToken } from './shared/google-auth.js';
//   const token = await getAccessToken(
//     env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
//     env.GOOGLE_PRIVATE_KEY,
//     'https://www.googleapis.com/auth/drive.readonly'
//   );
// ============================================================

// Builds a signed JWT and exchanges it for a Google OAuth2
// access token. The scope parameter determines which Google
// APIs the token can access.
//
// @param {string} email        - Service account email
// @param {string} rawPrivateKey - PEM private key (literal \n)
// @param {string} scope        - Google OAuth2 scope URL
// @returns {Promise<string>}   - Short-lived access token
export async function getAccessToken(email, rawPrivateKey, scope) {

  // Step 1 — Build the JWT header and payload.
  var now     = Math.floor(Date.now() / 1000);
  var header  = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var payload = base64url(JSON.stringify({
    iss:   email,
    scope: scope,
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }));

  var signingInput = header + '.' + payload;

  // Step 2 — Import the RSA private key via the Web Crypto API.
  // The key arrives from the secret with literal \n sequences;
  // convert them to real newlines before stripping the PEM envelope.
  // Both PKCS#8 and traditional RSA key headers are handled.
  var pemString = rawPrivateKey.replace(/\\n/g, '\n');
  var pemBody   = pemString
    .replace('-----BEGIN PRIVATE KEY-----',     '')
    .replace('-----END PRIVATE KEY-----',       '')
    .replace('-----BEGIN RSA PRIVATE KEY-----', '')
    .replace('-----END RSA PRIVATE KEY-----',   '')
    .replace(/\n/g, '')
    .trim();

  var binaryKey = Uint8Array.from(atob(pemBody), function(c) {
    return c.charCodeAt(0);
  });

  var cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Step 3 — Sign the JWT.
  // arrayBufferToBase64url uses a byte-by-byte loop to avoid
  // call-stack overflow on large buffers like RSA signatures.
  var signatureBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  var jwt = signingInput + '.' + arrayBufferToBase64url(signatureBuf);

  // Step 4 — Exchange the signed JWT for a short-lived access token.
  var tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt,
  });

  if (!tokenRes.ok) {
    var errText = await tokenRes.text();
    throw new Error(
      'Google token exchange failed (' + tokenRes.status + '): ' + errText
    );
  }

  var tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// Encodes a UTF-8 string to base64url format (used in JWT construction).
function base64url(str) {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g,  '');
}

// Converts an ArrayBuffer to base64url using a safe byte-by-byte loop.
// The spread operator can throw a RangeError on large buffers such as
// RSA signatures — this approach avoids that risk entirely.
function arrayBufferToBase64url(buffer) {
  var bytes  = new Uint8Array(buffer);
  var binary = '';
  for (var i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g,  '');
}