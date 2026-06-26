const HASH_ALGORITHM = "SHA-256";
const PBKDF2_ITERATIONS = 210000;
const PBKDF2_KEY_LENGTH_BITS = 256;
const PASSWORD_HASH_SEPARATOR = ":";

const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'; upgrade-insecure-requests",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cache-Control": "private, no-store",
};

export async function onRequestPost(context) {
  const configError = validateAdminAuthConfig(context.env);
  if (configError) return configError;

  let requestBody;
  try {
    requestBody = await context.request.json();
  } catch {
    return jsonResponse({ ok: false }, 400);
  }

  const password = typeof requestBody.password === "string" ? requestBody.password : "";
  const passwordMatches = await verifyConfiguredAdminPassword(password, context.env);

  return jsonResponse({ ok: passwordMatches }, passwordMatches ? 200 : 401);
}

export function onRequest(context) {
  if (context.request.method === "POST") {
    return onRequestPost(context);
  }

  return jsonResponse({ ok: false }, 405, { Allow: "POST" });
}

function validateAdminAuthConfig(env) {
  if (env.TAG_GAME_TEACHER_PASSWORD) return null;

  if (!env.TAG_GAME_TEACHER_PASSWORD_HASH) {
    return jsonResponse({ ok: false, error: "Teacher password is not configured." }, 500);
  }

  const parts = env.TAG_GAME_TEACHER_PASSWORD_HASH.split(PASSWORD_HASH_SEPARATOR);
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return jsonResponse({ ok: false, error: "Teacher password hash is invalid." }, 500);
  }

  return null;
}

async function verifyConfiguredAdminPassword(password, env) {
  if (env.TAG_GAME_TEACHER_PASSWORD) {
    return timingSafeEqualText(password, env.TAG_GAME_TEACHER_PASSWORD);
  }

  return verifyPasswordHash(password, env.TAG_GAME_TEACHER_PASSWORD_HASH);
}

async function verifyPasswordHash(password, storedHash) {
  const [saltBase64, expectedHashBase64] = storedHash.split(PASSWORD_HASH_SEPARATOR);
  const salt = base64ToBytes(saltBase64);
  const expectedHash = base64ToBytes(expectedHashBase64);
  const actualHash = await hashPassword(password, salt);

  return timingSafeEqual(actualHash, expectedHash);
}

async function hashPassword(password, salt) {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: HASH_ALGORITHM,
      salt,
      iterations: PBKDF2_ITERATIONS,
    },
    passwordKey,
    PBKDF2_KEY_LENGTH_BITS,
  );

  return new Uint8Array(derivedBits);
}

function timingSafeEqualText(left, right) {
  return timingSafeEqual(
    new TextEncoder().encode(left),
    new TextEncoder().encode(right),
  );
}

function timingSafeEqual(left, right) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }

  return difference === 0;
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...securityHeaders,
      ...extraHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
