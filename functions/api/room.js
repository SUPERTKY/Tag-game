const ROOM_TIMEOUT_MS = 1000 * 60 * 60 * 6;
const PLAYER_TIMEOUT_MS = 1000 * 15;

const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'; upgrade-insecure-requests",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cache-Control": "private, no-store",
};

let room = null;

export async function onRequest(context) {
  clearExpiredRoom();

  switch (context.request.method) {
    case "GET":
      return jsonResponse(getRoomStatus());
    case "POST":
      return handlePost(context.request);
    case "DELETE":
      room = null;
      return jsonResponse(getRoomStatus());
    default:
      return jsonResponse({ ok: false }, 405, { Allow: "GET, POST, DELETE" });
  }
}

async function handlePost(request) {
  let body = {};

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body.action === "create") {
    if (!room) {
      room = {
        id: crypto.randomUUID(),
        status: "waiting",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        players: {},
      };
    }

    return jsonResponse(getRoomStatus(), room.status === "waiting" ? 201 : 200);
  }

  if (body.action === "start") {
    if (!room) return jsonResponse({ ok: false, error: "部屋がありません。" }, 404);

    room.status = "playing";
    room.updatedAt = Date.now();
    return jsonResponse(getRoomStatus());
  }

  if (body.action === "join" || body.action === "updatePlayer") {
    if (!room) return jsonResponse({ ok: false, error: "部屋がありません。" }, 404);

    const playerId = sanitizePlayerId(body.playerId);
    if (!playerId) return jsonResponse({ ok: false, error: "プレイヤーIDが不正です。" }, 400);

    room.players[playerId] = {
      id: playerId,
      x: clampNumber(body.x, 0, body.worldWidth || 5000),
      y: clampNumber(body.y, 0, body.worldHeight || 3500),
      facing: body.facing === -1 ? -1 : 1,
      running: Boolean(body.running),
      updatedAt: Date.now(),
    };
    room.updatedAt = Date.now();
    clearInactivePlayers();

    return jsonResponse(getRoomStatus());
  }

  return jsonResponse({ ok: false, error: "Unknown action." }, 400);
}

function clearExpiredRoom() {
  if (!room) return;

  if (Date.now() - room.updatedAt > ROOM_TIMEOUT_MS) {
    room = null;
  }
}

function getRoomStatus() {
  clearInactivePlayers();

  return {
    ok: true,
    exists: Boolean(room),
    status: room?.status || "none",
    roomId: room?.id || null,
    players: room ? Object.values(room.players) : [],
  };
}

function clearInactivePlayers() {
  if (!room) return;

  const now = Date.now();
  for (const [playerId, player] of Object.entries(room.players)) {
    if (now - player.updatedAt > PLAYER_TIMEOUT_MS) {
      delete room.players[playerId];
    }
  }
}

function sanitizePlayerId(playerId) {
  if (typeof playerId !== "string") return "";
  return /^[a-zA-Z0-9-]{8,64}$/.test(playerId) ? playerId : "";
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
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
