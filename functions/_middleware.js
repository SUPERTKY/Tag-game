const AUTH_REALM = "Tag Game";
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
};

export async function onRequest(context) {
  const unauthorizedResponse = validateAuthConfig(context.env);
  if (unauthorizedResponse) return unauthorizedResponse;

  const authHeader = context.request.headers.get("Authorization") || "";
  const credentials = parseBasicAuth(authHeader);

  if (!credentials || credentials.username !== context.env.TAG_GAME_USERNAME) {
    return unauthorized();
  }

  const passwordMatches = await verifyPassword(
    credentials.password,
    context.env.TAG_GAME_PASSWORD_HASH,
  );

  if (!passwordMatches) return unauthorized();

  const response = await context.next();
  const securedResponse = new Response(response.body, response);

  for (const [name, value] of Object.entries(securityHeaders)) {
    securedResponse.headers.set(name, value);
  }

  securedResponse.headers.set("Cache-Control", "private, no-store");
  return securedResponse;
}

function validateAuthConfig(env) {
  if (!env.TAG_GAME_USERNAME || !env.TAG_GAME_PASSWORD_HASH) {
    return new Response("Authentication is not configured.", {
      status: 500,
      headers: securityHeaders,
    });
  }

  const parts = env.TAG_GAME_PASSWORD_HASH.split(PASSWORD_HASH_SEPARATOR);
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return new Response("Password hash is invalid.", {
      status: 500,
      headers: securityHeaders,
    });
  }

  return null;
}

function parseBasicAuth(authHeader) {
  if (!authHeader.startsWith("Basic ")) return null;

  try {
    const decoded = atob(authHeader.slice("Basic ".length));
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) return null;

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

async function verifyPassword(password, storedHash) {
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

function unauthorized() {
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      ...securityHeaders,
      "WWW-Authenticate": `Basic realm="${AUTH_REALM}", charset="UTF-8"`,
      "Cache-Control": "private, no-store",
    },
  });
}
