const APP_STATE_ID = "partyup";
const REDIS_KEY = "partyup:state";

function defaultData() {
  return { recruits: [], rooms: {}, deletedRecruitIds: [], deletedRoomIds: [], deletedBoardPostIds: [], deletedCommentIds: [], deletedReportIds: [], deletedBanIds: [], deletedAccountIds: [], friendRequests: [], friendships: [], directMessages: {}, boardPosts: [], lobbyMessages: [], reports: [], bans: [], userAccounts: [] };
}

function normalizeData(input = {}) {
  return {
    recruits: Array.isArray(input.recruits) ? input.recruits : [],
    rooms: input.rooms && typeof input.rooms === "object" && !Array.isArray(input.rooms) ? input.rooms : {},
    deletedRecruitIds: Array.isArray(input.deletedRecruitIds) ? input.deletedRecruitIds : [],
    deletedRoomIds: Array.isArray(input.deletedRoomIds) ? input.deletedRoomIds : [],
    deletedBoardPostIds: Array.isArray(input.deletedBoardPostIds) ? input.deletedBoardPostIds : [],
    deletedCommentIds: Array.isArray(input.deletedCommentIds) ? input.deletedCommentIds : [],
    deletedReportIds: Array.isArray(input.deletedReportIds) ? input.deletedReportIds : [],
    deletedBanIds: Array.isArray(input.deletedBanIds) ? input.deletedBanIds : [],
    deletedAccountIds: Array.isArray(input.deletedAccountIds) ? input.deletedAccountIds : [],
    friendRequests: Array.isArray(input.friendRequests) ? input.friendRequests : [],
    friendships: Array.isArray(input.friendships) ? input.friendships : [],
    directMessages: input.directMessages && typeof input.directMessages === "object" && !Array.isArray(input.directMessages) ? input.directMessages : {},
    boardPosts: Array.isArray(input.boardPosts) ? input.boardPosts : [],
    lobbyMessages: Array.isArray(input.lobbyMessages) ? input.lobbyMessages : [],
    reports: Array.isArray(input.reports) ? input.reports : [],
    bans: Array.isArray(input.bans) ? input.bans : [],
    userAccounts: Array.isArray(input.userAccounts) ? input.userAccounts : []
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

function mergeRooms(currentRooms = {}, incomingRooms = {}, deletedRoomIds = []) {
  const rooms = { ...currentRooms };
  deletedRoomIds.forEach((roomId) => delete rooms[roomId]);
  Object.entries(incomingRooms || {}).forEach(([roomId, incomingRoom]) => {
    if (deletedRoomIds.includes(roomId)) return;
    const currentRoom = rooms[roomId] || {};
    const participantStatus = { ...(currentRoom.participantStatus || {}) };
    [...(currentRoom.removedParticipants || [])].forEach((nickname) => {
      if (!participantStatus[nickname]) participantStatus[nickname] = { state: "removed", at: "" };
    });
    [...(currentRoom.kicked || [])].forEach((nickname) => {
      if (!participantStatus[nickname]) participantStatus[nickname] = { state: "kicked", at: "" };
    });
    Object.entries(incomingRoom.participantStatus || {}).forEach(([nickname, status]) => {
      const previousTime = new Date(participantStatus[nickname]?.at || 0).getTime();
      const nextTime = new Date(status?.at || 0).getTime();
      if (!participantStatus[nickname] || nextTime >= previousTime) participantStatus[nickname] = status;
    });
    const kicked = Object.entries(participantStatus).filter(([, status]) => status?.state === "kicked").map(([nickname]) => nickname);
    const removedParticipants = Object.entries(participantStatus).filter(([, status]) => status?.state === "removed").map(([nickname]) => nickname);
    const participants = [...new Set([...(currentRoom.participants || []), ...(incomingRoom.participants || []), ...Object.entries(participantStatus).filter(([, status]) => status?.state === "active").map(([nickname]) => nickname)])].filter((nickname) => !kicked.includes(nickname) && !removedParticipants.includes(nickname));
    rooms[roomId] = {
      ...currentRoom,
      ...incomingRoom,
      participants,
      participantStatus,
      removedParticipants,
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
    if (!item?.id) return;
    const previous = merged.get(item.id) || {};
    const next = { ...previous, ...item };
    if (["수락", "거절", "삭제", "허락", "나감", "강퇴", "처리됨"].includes(previous.status) && item.status === "대기") next.status = previous.status;
    if (previous.deletedAt && !item.deletedAt) next.deletedAt = previous.deletedAt;
    merged.set(item.id, next);
  });
  return [...merged.values()];
}

function mergeUserAccounts(current = [], incoming = [], deletedAccountIds = []) {
  const merged = new Map();
  current.forEach((account) => {
    if (account?.loginId && !deletedAccountIds.includes(account.id)) merged.set(String(account.loginId).trim().toLowerCase(), account);
  });
  incoming.forEach((account) => {
    if (!account?.loginId || deletedAccountIds.includes(account.id)) return;
    const loginId = String(account.loginId).trim().toLowerCase();
    merged.set(loginId, { ...(merged.get(loginId) || {}), ...account, loginId });
  });
  return [...merged.values()];
}

function mergeRecruits(current = [], incoming = [], deletedRecruitIds = []) {
  const merged = new Map();
  current.forEach((recruit) => {
    if (recruit?.id && !deletedRecruitIds.includes(recruit.id)) merged.set(recruit.id, recruit);
  });
  incoming.forEach((recruit) => {
    if (!recruit?.id || deletedRecruitIds.includes(recruit.id)) return;
    const previous = merged.get(recruit.id) || {};
    merged.set(recruit.id, {
      ...previous,
      ...recruit,
      requests: mergeById(previous.requests || [], recruit.requests || [])
    });
  });
  return [...merged.values()];
}

function mergeBoardPosts(current = [], incoming = [], deletedBoardPostIds = [], deletedCommentIds = []) {
  const merged = new Map();
  current.forEach((post) => {
    if (post?.id && !deletedBoardPostIds.includes(post.id)) merged.set(post.id, post);
  });
  incoming.forEach((post) => {
    if (!post?.id || deletedBoardPostIds.includes(post.id)) return;
    const previous = merged.get(post.id) || {};
    merged.set(post.id, {
      ...previous,
      ...post,
      messages: mergeById(previous.messages || [], post.messages || []).filter((message) => !deletedCommentIds.includes(message.id))
    });
  });
  return [...merged.values()];
}

function mergeState(currentInput = {}, incomingInput = {}) {
  const current = normalizeData(currentInput);
  const incoming = incomingInput && typeof incomingInput === "object" ? incomingInput : {};
  const normalizedIncoming = normalizeData(incoming);
  const deletedRecruitIds = [...new Set([...current.deletedRecruitIds, ...normalizedIncoming.deletedRecruitIds])];
  const deletedRoomIds = [...new Set([...current.deletedRoomIds, ...normalizedIncoming.deletedRoomIds])];
  const deletedBoardPostIds = [...new Set([...current.deletedBoardPostIds, ...normalizedIncoming.deletedBoardPostIds])];
  const deletedCommentIds = [...new Set([...current.deletedCommentIds, ...normalizedIncoming.deletedCommentIds])];
  const deletedReportIds = [...new Set([...current.deletedReportIds, ...normalizedIncoming.deletedReportIds])];
  const deletedBanIds = [...new Set([...current.deletedBanIds, ...normalizedIncoming.deletedBanIds])];
  const deletedAccountIds = [...new Set([...current.deletedAccountIds, ...normalizedIncoming.deletedAccountIds])];
  return {
    recruits: Object.prototype.hasOwnProperty.call(incoming, "recruits") ? mergeRecruits(current.recruits, normalizedIncoming.recruits, deletedRecruitIds) : current.recruits.filter((recruit) => !deletedRecruitIds.includes(recruit.id)),
    rooms: mergeRooms(current.rooms, normalizedIncoming.rooms, deletedRoomIds),
    deletedRecruitIds,
    deletedRoomIds,
    deletedBoardPostIds,
    deletedCommentIds,
    deletedReportIds,
    deletedBanIds,
    deletedAccountIds,
    friendRequests: mergeById(current.friendRequests, normalizedIncoming.friendRequests),
    friendships: mergeById(current.friendships, normalizedIncoming.friendships),
    directMessages: mergeObjectMessageLists(current.directMessages, normalizedIncoming.directMessages),
    boardPosts: Object.prototype.hasOwnProperty.call(incoming, "boardPosts")
      ? mergeBoardPosts(current.boardPosts, normalizedIncoming.boardPosts, deletedBoardPostIds, deletedCommentIds)
      : current.boardPosts.filter((post) => !deletedBoardPostIds.includes(post.id)).map((post) => ({ ...post, messages: (post.messages || []).filter((message) => !deletedCommentIds.includes(message.id)) })),
    lobbyMessages: mergeMessages(current.lobbyMessages, normalizedIncoming.lobbyMessages),
    reports: mergeById(current.reports, normalizedIncoming.reports).filter((report) => !deletedReportIds.includes(report.id)),
    bans: mergeById(current.bans, normalizedIncoming.bans).filter((ban) => !deletedBanIds.includes(ban.id)),
    userAccounts: mergeUserAccounts(current.userAccounts, normalizedIncoming.userAccounts, deletedAccountIds)
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
