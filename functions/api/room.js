const ROOM_TIMEOUT_MS = 1000 * 60 * 60 * 6;

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

  return jsonResponse({ ok: false, error: "Unknown action." }, 400);
}

function clearExpiredRoom() {
  if (!room) return;

  if (Date.now() - room.updatedAt > ROOM_TIMEOUT_MS) {
    room = null;
  }
}

function getRoomStatus() {
  return {
    ok: true,
    exists: Boolean(room),
    status: room?.status || "none",
    roomId: room?.id || null,
  };
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
