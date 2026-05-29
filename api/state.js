const APP_STATE_ID = "partyup";
const REDIS_KEY = "partyup:state";

function defaultData() {
  return { recruits: [], rooms: {}, friendRequests: [], friendships: [], directMessages: {}, boardPosts: [], lobbyMessages: [], reports: [], bans: [] };
}

function normalizeData(input = {}) {
  return {
    recruits: Array.isArray(input.recruits) ? input.recruits : [],
    rooms: input.rooms && typeof input.rooms === "object" && !Array.isArray(input.rooms) ? input.rooms : {},
    friendRequests: Array.isArray(input.friendRequests) ? input.friendRequests : [],
    friendships: Array.isArray(input.friendships) ? input.friendships : [],
    directMessages: input.directMessages && typeof input.directMessages === "object" && !Array.isArray(input.directMessages) ? input.directMessages : {},
    boardPosts: Array.isArray(input.boardPosts) ? input.boardPosts : [],
    lobbyMessages: Array.isArray(input.lobbyMessages) ? input.lobbyMessages : [],
    reports: Array.isArray(input.reports) ? input.reports : [],
    bans: Array.isArray(input.bans) ? input.bans : []
  };
}

function uniqueById(items = []) {
  const seen = new Map();
  items.forEach((item) => {
    if (item && typeof item === "object") seen.set(item.id || JSON.stringify(item), item);
  });
  return [...seen.values()];
}

function mergeMessages(current = [], incoming = []) {
  return uniqueById([...current, ...incoming])
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
    .slice(-300);
}

function mergeRooms(currentRooms = {}, incomingRooms = {}) {
  const rooms = { ...currentRooms };
  Object.entries(incomingRooms || {}).forEach(([roomId, incomingRoom]) => {
    const currentRoom = rooms[roomId] || {};
    const kicked = [...new Set([...(currentRoom.kicked || []), ...(incomingRoom.kicked || [])])];
    const participants = [...new Set([...(currentRoom.participants || []), ...(incomingRoom.participants || [])])].filter((nickname) => !kicked.includes(nickname));
    rooms[roomId] = {
      ...currentRoom,
      ...incomingRoom,
      participants,
      kicked,
      messages: mergeMessages(currentRoom.messages, incomingRoom.messages)
    };
  });
  return rooms;
}

function mergeObjectMessageLists(current = {}, incoming = {}) {
  const merged = { ...current };
  Object.entries(incoming || {}).forEach(([key, messages]) => {
    merged[key] = mergeMessages(merged[key], messages);
  });
  return merged;
}

function mergeById(current = [], incoming = []) {
  const merged = new Map();
  current.forEach((item) => {
    if (item?.id) merged.set(item.id, item);
  });
  incoming.forEach((item) => {
    if (item?.id) merged.set(item.id, { ...(merged.get(item.id) || {}), ...item });
  });
  return [...merged.values()];
}

function mergeRecruits(current = [], incoming = []) {
  const merged = new Map();
  current.forEach((recruit) => {
    if (recruit?.id) merged.set(recruit.id, recruit);
  });
  incoming.forEach((recruit) => {
    if (!recruit?.id) return;
    const previous = merged.get(recruit.id) || {};
    merged.set(recruit.id, {
      ...previous,
      ...recruit,
      requests: mergeById(previous.requests || [], recruit.requests || [])
    });
  });
  return [...merged.values()];
}

function mergeState(currentInput = {}, incomingInput = {}) {
  const current = normalizeData(currentInput);
  const incoming = incomingInput && typeof incomingInput === "object" ? incomingInput : {};
  const normalizedIncoming = normalizeData(incoming);
  return {
    recruits: Object.prototype.hasOwnProperty.call(incoming, "recruits") ? mergeRecruits(current.recruits, normalizedIncoming.recruits) : current.recruits,
    rooms: mergeRooms(current.rooms, normalizedIncoming.rooms),
    friendRequests: mergeById(current.friendRequests, normalizedIncoming.friendRequests),
    friendships: mergeById(current.friendships, normalizedIncoming.friendships),
    directMessages: mergeObjectMessageLists(current.directMessages, normalizedIncoming.directMessages),
    boardPosts: Object.prototype.hasOwnProperty.call(incoming, "boardPosts") ? normalizedIncoming.boardPosts : current.boardPosts,
    lobbyMessages: mergeMessages(current.lobbyMessages, normalizedIncoming.lobbyMessages),
    reports: mergeById(current.reports, normalizedIncoming.reports),
    bans: mergeById(current.bans, normalizedIncoming.bans)
  };
}

function sendJson(res, status, data) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.status(status).json(data);
}

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Missing Upstash Redis environment variables");
  return { url: url.replace(/\/$/, ""), token };
}

async function redisCommand(command) {
  const { url, token } = redisConfig();
  const response = await fetch(`${url}/${command}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Upstash command failed: ${response.status}`);
  return response.json();
}

async function readRedisState() {
  const data = await redisCommand(`get/${encodeURIComponent(REDIS_KEY)}`);
  return normalizeData(data.result ? JSON.parse(data.result) : defaultData());
}

async function writeRedisState(data) {
  const nextData = mergeState(await readRedisState(), data);
  const { url, token } = redisConfig();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(["SET", REDIS_KEY, JSON.stringify(nextData)])
  });
  if (!response.ok) throw new Error(`Upstash command failed: ${response.status}`);
  return nextData;
}

function supabaseHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
}

function supabaseBaseUrl() {
  const url = process.env.SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return `${url.replace(/\/$/, "")}/rest/v1/app_state`;
}

async function readState() {
  if (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) {
    return readRedisState();
  }

  const response = await fetch(`${supabaseBaseUrl()}?select=data&id=eq.${APP_STATE_ID}&limit=1`, {
    headers: supabaseHeaders()
  });
  if (!response.ok) throw new Error(`Supabase read failed: ${response.status}`);
  const rows = await response.json();
  return normalizeData(rows[0]?.data || defaultData());
}

async function writeState(data) {
  const input = typeof data === "string" ? JSON.parse(data) : data;
  if (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) {
    return writeRedisState(input);
  }

  const nextData = mergeState(await readState(), input);
  const response = await fetch(`${supabaseBaseUrl()}?on_conflict=id`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify({
      id: APP_STATE_ID,
      data: nextData,
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error(`Supabase write failed: ${response.status}`);
  return nextData;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});

  try {
    if (req.method === "GET") return sendJson(res, 200, await readState());
    if (req.method !== "PUT") return sendJson(res, 405, { error: "Method not allowed" });
    return sendJson(res, 200, await writeState(req.body || {}));
  } catch (error) {
    return sendJson(res, 500, {
      error: "Shared state server is not configured",
      message: error.message
    });
  }
};
