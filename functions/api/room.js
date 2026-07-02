const ROOM_TIMEOUT_MS = 1000 * 60 * 60 * 6;
const PLAYER_TIMEOUT_MS = 1000 * 15;
const ROOM_CACHE_KEY = "https://tag-game.local/cache/room-state";
const GAME_COUNTDOWN_MS = 5000;
const ROUND_DURATION_MS = 1000 * 60 * 3;
const DEMON_SPAWN_AREA = { x: 2350, y: 1600, width: 300, height: 300 };

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
  const savedRoom = await readRoom(cache);
  const room = normalizeRoom(clearExpiredRoom(savedRoom));
  if (savedRoom && !room) await deleteRoom(cache);

  switch (context.request.method) {
    case "GET": {
      const roomStatus = getRoomStatus(room);
      if (room?.winner && Object.keys(room.players).length === 0) {
        await deleteRoom(cache);
        return jsonResponse(getRoomStatus(null));
      }
      if (room) await writeRoom(cache, room);
      return jsonResponse(roomStatus);
    }
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
        countdownEndsAt: null,
        roundEndsAt: null,
        winner: null,
        players: {},
      };
    }

    await writeRoom(cache, room);
    return jsonResponse(getRoomStatus(room), room.status === "waiting" ? 201 : 200);
  }

  if (body.action === "start") {
    if (!room) return jsonResponse({ ok: false, error: "部屋がありません。" }, 404);

    clearInactivePlayers(room);
    room.status = "preparing";
    room.countdownEndsAt = null;
    room.roundEndsAt = null;
    room.winner = null;
    room.updatedAt = Date.now();
    await mergeLatestRoomState(cache, room);
    await writeRoom(cache, room);
    return jsonResponse(getRoomStatus(room));
  }

  if (body.action === "startTagGame") {
    if (!room) return jsonResponse({ ok: false, error: "部屋がありません。" }, 404);

    clearInactivePlayers(room);
    assignItPlayersForRound(room);
    room.status = "countdown";
    room.countdownEndsAt = Date.now() + GAME_COUNTDOWN_MS;
    room.roundEndsAt = room.countdownEndsAt + ROUND_DURATION_MS;
    room.winner = null;
    room.updatedAt = Date.now();
    await writeRoom(cache, room);
    return jsonResponse(getRoomStatus(room));
  }

  if (body.action === "join" || body.action === "updatePlayer") {
    if (!room) return jsonResponse({ ok: false, error: "部屋がありません。" }, 404);

    const playerId = sanitizePlayerId(body.playerId);
    if (!playerId) return jsonResponse({ ok: false, error: "プレイヤーIDが不正です。" }, 400);
    if (room.winner && !room.players[playerId]) {
      return jsonResponse({ ok: false, error: "ゲーム終了後は入室できません。" }, 403);
    }

    clearInactivePlayers(room);
    if (room.winner && Object.keys(room.players).length === 0) {
      await deleteRoom(cache);
      return jsonResponse(getRoomStatus(null));
    }
    await mergeLatestRoomState(cache, room);

    const existingPlayer = room.players[playerId];
    const requestedRole = normalizePlayerRole(body.role);
    const role = isItRole(existingPlayer?.role) ? existingPlayer.role : requestedRole;
    const isIt = Boolean(existingPlayer?.isIt || (isRoundStarted(room.status) && isItRole(role)));
    const frozenItSpawn = room.status === "countdown" && isIt;

    room.players[playerId] = {
      id: playerId,
      x: frozenItSpawn ? getDemonSpawnX(playerId) : clampNumber(body.x, 0, body.worldWidth || 5000),
      y: frozenItSpawn ? getDemonSpawnY(playerId) : clampNumber(body.y, 0, body.worldHeight || 3500),
      facing: body.facing === -1 ? -1 : 1,
      running: room.status === "playing" ? Boolean(body.running) : false,
      isIt,
      role,
      startedAsIt: Boolean(existingPlayer?.startedAsIt || (isRoundStarted(room.status) && isItRole(role))),
      tagCount: clampNumber(existingPlayer?.tagCount, 0, Number.MAX_SAFE_INTEGER),
      updatedAt: Date.now(),
    };
    room.updatedAt = Date.now();
    await writeRoom(cache, room);

    return jsonResponse(getRoomStatus(room));
  }

  if (body.action === "leave") {
    if (!room) return jsonResponse(getRoomStatus(null));

    const playerId = sanitizePlayerId(body.playerId);
    if (!playerId) return jsonResponse({ ok: false, error: "プレイヤーIDが不正です。" }, 400);

    delete room.players[playerId];
    room.updatedAt = Date.now();

    if (room.winner && Object.keys(room.players).length === 0) {
      await deleteRoom(cache);
      return jsonResponse(getRoomStatus(null));
    }

    await writeRoom(cache, room);
    return jsonResponse(getRoomStatus(room));
  }

  if (body.action === "tag") {
    if (!room) return jsonResponse({ ok: false, error: "部屋がありません。" }, 404);

    const taggerId = sanitizePlayerId(body.playerId);
    const targetId = sanitizePlayerId(body.targetId);
    if (!taggerId || !targetId) return jsonResponse({ ok: false, error: "プレイヤーIDが不正です。" }, 400);

    clearInactivePlayers(room);
    await mergeLatestRoomState(cache, room);

    const tagger = room.players[taggerId];
    const target = room.players[targetId];
    if (room.status === "playing" && tagger?.isIt && target && !target.isIt) {
      tagger.tagCount = clampNumber(tagger.tagCount, 0, Number.MAX_SAFE_INTEGER) + 1;
      target.isIt = true;
      if (target.role !== "demon") target.role = "oni";
      target.startedAsIt = Boolean(target.startedAsIt);
      target.tagCount = clampNumber(target.tagCount, 0, Number.MAX_SAFE_INTEGER);
      target.updatedAt = Date.now();
      updateWinner(room);
      room.updatedAt = Date.now();
    }

    await writeRoom(cache, room);

    return jsonResponse(getRoomStatus(room));
  }

  return jsonResponse({ ok: false, error: "Unknown action." }, 400);
}

async function mergeLatestRoomState(cache, room) {
  if (!room) return;

  const latestRoom = normalizeRoom(await readRoom(cache));
  if (!latestRoom || latestRoom.id !== room.id) return;

  if (getStatusRank(latestRoom.status) > getStatusRank(room.status)) {
    room.status = latestRoom.status;
    room.countdownEndsAt = latestRoom.countdownEndsAt || null;
    room.roundEndsAt = latestRoom.roundEndsAt || null;
    room.winner = latestRoom.winner || null;
  } else if (latestRoom.status === room.status) {
    room.countdownEndsAt = latestRoom.countdownEndsAt || room.countdownEndsAt || null;
    room.roundEndsAt = latestRoom.roundEndsAt || room.roundEndsAt || null;
    room.winner = latestRoom.winner || room.winner || null;
  }

  for (const [latestPlayerId, latestPlayer] of Object.entries(latestRoom.players || {})) {
    const player = room.players[latestPlayerId];
    if (!player || !latestPlayer.isIt) continue;

    player.isIt = true;
    player.startedAsIt = Boolean(player.startedAsIt || latestPlayer.startedAsIt);
    player.tagCount = Math.max(clampNumber(player.tagCount, 0, Number.MAX_SAFE_INTEGER), clampNumber(latestPlayer.tagCount, 0, Number.MAX_SAFE_INTEGER));
    if (isItRole(latestPlayer.role)) player.role = latestPlayer.role;
  }
}

function getStatusRank(status) {
  switch (status) {
    case "waiting":
      return 0;
    case "preparing":
      return 1;
    case "countdown":
      return 2;
    case "playing":
      return 3;
    default:
      return -1;
  }
}

function clearExpiredRoom(room) {
  if (!room) return null;

  const now = Date.now();

  if (now - room.updatedAt > ROOM_TIMEOUT_MS) {
    return null;
  }

  return room;
}

function getRoomStatus(room) {
  normalizeRoom(room);
  clearInactivePlayers(room);
  updateWinner(room);

  return {
    ok: true,
    exists: Boolean(room),
    status: room?.status || "none",
    roomId: room?.id || null,
    countdownEndsAt: room?.countdownEndsAt || null,
    roundEndsAt: room?.roundEndsAt || null,
    winner: room?.winner || null,
    demonSpawnArea: room ? DEMON_SPAWN_AREA : null,
    players: room ? Object.values(room.players).map(serializePlayer) : [],
  };
}

function serializePlayer(player) {
  return {
    ...player,
    tagCount: clampNumber(player.tagCount, 0, Number.MAX_SAFE_INTEGER),
    startedAsIt: Boolean(player.startedAsIt),
    pursuerWinnerEligible: Boolean(player.startedAsIt || clampNumber(player.tagCount, 0, Number.MAX_SAFE_INTEGER) >= 3),
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
}

function normalizeRoom(room) {
  if (!room) return null;

  if (room.status === "countdown" && room.countdownEndsAt && Date.now() >= room.countdownEndsAt) {
    room.status = "playing";
    room.countdownEndsAt = null;
    room.updatedAt = Date.now();
  }

  updateWinner(room);

  return room;
}

function updateWinner(room) {
  if (!room || room.winner || room.status !== "playing") return;

  const players = Object.values(room.players || {});
  const hasFugitive = players.some((player) => !player.isIt);

  if (!hasFugitive) {
    room.winner = "pursuer";
    room.updatedAt = Date.now();
    return;
  }

  if (room.roundEndsAt && Date.now() >= room.roundEndsAt) {
    room.winner = "fugitive";
    room.updatedAt = Date.now();
  }
}

function normalizePlayerRole(role) {
  return isItRole(role) ? role : "player";
}

function isItRole(role) {
  return role === "demon" || role === "oni";
}

function isRoundStarted(status) {
  return status === "countdown" || status === "playing";
}

function assignItPlayersForRound(room) {
  const players = Object.values(room.players);
  if (players.length === 0) return;

  const targetItCount = Math.ceil(players.length * 0.1);
  for (const player of players) {
    if (player.role === "demon") {
      player.isIt = true;
      player.startedAsIt = true;
    } else {
      player.role = "player";
      player.isIt = false;
      player.startedAsIt = false;
    }
    player.tagCount = 0;
  }

  const candidates = shufflePlayers(players.filter((player) => !player.isIt));
  let currentItCount = players.filter((player) => player.isIt).length;
  for (const player of candidates) {
    if (currentItCount >= targetItCount) break;
    player.isIt = true;
    player.role = "oni";
    player.startedAsIt = true;
    player.tagCount = 0;
    currentItCount += 1;
  }

  for (const player of players) {
    if (!player.isIt) continue;
    player.x = getDemonSpawnX(player.id);
    player.y = getDemonSpawnY(player.id);
    player.running = false;
    player.updatedAt = Date.now();
  }
}

function shufflePlayers(players) {
  const shuffledPlayers = [...players];
  for (let index = shuffledPlayers.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffledPlayers[index], shuffledPlayers[swapIndex]] = [shuffledPlayers[swapIndex], shuffledPlayers[index]];
  }
  return shuffledPlayers;
}

function getDemonSpawnX(playerId) {
  return DEMON_SPAWN_AREA.x + stablePlayerOffset(playerId, DEMON_SPAWN_AREA.width);
}

function getDemonSpawnY(playerId) {
  return DEMON_SPAWN_AREA.y + stablePlayerOffset([...playerId].reverse().join(""), DEMON_SPAWN_AREA.height);
}

function stablePlayerOffset(playerId, maxOffset) {
  let hash = 0;
  for (let index = 0; index < playerId.length; index += 1) {
    hash = (hash * 31 + playerId.charCodeAt(index)) >>> 0;
  }
  return hash % Math.max(1, maxOffset);
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
