const ROOM_TIMEOUT_MS = 1000 * 60 * 60 * 6;
const PLAYER_TIMEOUT_MS = 1000 * 15;
const ROOM_CACHE_KEY = "https://tag-game.local/cache/room-state";

const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'; upgrade-insecure-requests",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cache-Control": "private, no-store",
};

export async function onRequest(context) {
  const cache = caches.default;
  const room = clearExpiredRoom(await readRoom(cache));

  switch (context.request.method) {
    case "GET":
      if (room) await writeRoom(cache, room);
      return jsonResponse(getRoomStatus(room));
    case "POST":
      return handlePost(context.request, cache, room);
    case "DELETE":
      await deleteRoom(cache);
      return jsonResponse(getRoomStatus(null));
    default:
      return jsonResponse({ ok: false }, 405, { Allow: "GET, POST, DELETE" });
  }
}

async function handlePost(request, cache, currentRoom) {
  let body = {};

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  let room = currentRoom;

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

    await writeRoom(cache, room);
    return jsonResponse(getRoomStatus(room), room.status === "waiting" ? 201 : 200);
  }

  if (body.action === "start") {
    if (!room) return jsonResponse({ ok: false, error: "部屋がありません。" }, 404);

    room.status = "playing";
    room.updatedAt = Date.now();
    await writeRoom(cache, room);
    return jsonResponse(getRoomStatus(room));
  }

  if (body.action === "join" || body.action === "updatePlayer") {
    if (!room) return jsonResponse({ ok: false, error: "部屋がありません。" }, 404);

    const playerId = sanitizePlayerId(body.playerId);
    if (!playerId) return jsonResponse({ ok: false, error: "プレイヤーIDが不正です。" }, 400);

    clearInactivePlayers(room);

    const existingPlayer = room.players[playerId];
    const shouldBecomeIt = body.action === "join" && !hasItPlayer(room);

    room.players[playerId] = {
      id: playerId,
      x: clampNumber(body.x, 0, body.worldWidth || 5000),
      y: clampNumber(body.y, 0, body.worldHeight || 3500),
      facing: body.facing === -1 ? -1 : 1,
      running: Boolean(body.running),
      isIt: Boolean(existingPlayer?.isIt || shouldBecomeIt),
      updatedAt: Date.now(),
    };
    ensureItPlayer(room);
    room.updatedAt = Date.now();
    await writeRoom(cache, room);

    return jsonResponse(getRoomStatus(room));
  }

  if (body.action === "tag") {
    if (!room) return jsonResponse({ ok: false, error: "部屋がありません。" }, 404);

    const taggerId = sanitizePlayerId(body.playerId);
    const targetId = sanitizePlayerId(body.targetId);
    if (!taggerId || !targetId) return jsonResponse({ ok: false, error: "プレイヤーIDが不正です。" }, 400);

    clearInactivePlayers(room);

    if (room.players[taggerId]?.isIt && room.players[targetId]) {
      room.players[targetId].isIt = true;
      room.players[targetId].updatedAt = Date.now();
      room.updatedAt = Date.now();
    }

    ensureItPlayer(room);
    await writeRoom(cache, room);

    return jsonResponse(getRoomStatus(room));
  }

  return jsonResponse({ ok: false, error: "Unknown action." }, 400);
}

function clearExpiredRoom(room) {
  if (!room) return null;

  if (Date.now() - room.updatedAt > ROOM_TIMEOUT_MS) {
    return null;
  }

  return room;
}

function getRoomStatus(room) {
  clearInactivePlayers(room);

  return {
    ok: true,
    exists: Boolean(room),
    status: room?.status || "none",
    roomId: room?.id || null,
    players: room ? Object.values(room.players) : [],
  };
}

function clearInactivePlayers(room) {
  if (!room) return;

  const now = Date.now();
  for (const [playerId, player] of Object.entries(room.players)) {
    if (now - player.updatedAt > PLAYER_TIMEOUT_MS) {
      delete room.players[playerId];
    }
  }

  ensureItPlayer(room);
}

function hasItPlayer(room) {
  return Object.values(room.players).some((player) => player.isIt);
}

function ensureItPlayer(room) {
  if (!room || hasItPlayer(room)) return;

  const [firstPlayer] = Object.values(room.players);
  if (firstPlayer) firstPlayer.isIt = true;
}

async function readRoom(cache) {
  const response = await cache.match(ROOM_CACHE_KEY);
  if (!response) return null;

  try {
    return await response.json();
  } catch {
    await deleteRoom(cache);
    return null;
  }
}

async function writeRoom(cache, room) {
  await cache.put(
    ROOM_CACHE_KEY,
    new Response(JSON.stringify(room), {
      headers: {
        "Cache-Control": `public, max-age=${Math.ceil(ROOM_TIMEOUT_MS / 1000)}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    }),
  );
}

async function deleteRoom(cache) {
  await cache.delete(ROOM_CACHE_KEY);
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
