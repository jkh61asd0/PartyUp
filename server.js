const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, "db.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml; charset=utf-8"
};

function defaultData() {
  return { recruits: [], rooms: {}, deletedRecruitIds: [], deletedRoomIds: [], deletedBoardPostIds: [], deletedCommentIds: [], deletedReportIds: [], deletedBanIds: [], deletedAccountIds: [], friendRequests: [], friendships: [], directMessages: {}, boardPosts: [], lobbyMessages: [], reports: [], bans: [], userAccounts: [] };
}

function readDatabase() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    return {
      recruits: Array.isArray(data.recruits) ? data.recruits : [],
      rooms: data.rooms && typeof data.rooms === "object" && !Array.isArray(data.rooms) ? data.rooms : {},
      deletedRecruitIds: Array.isArray(data.deletedRecruitIds) ? data.deletedRecruitIds : [],
      deletedRoomIds: Array.isArray(data.deletedRoomIds) ? data.deletedRoomIds : [],
      deletedBoardPostIds: Array.isArray(data.deletedBoardPostIds) ? data.deletedBoardPostIds : [],
      deletedCommentIds: Array.isArray(data.deletedCommentIds) ? data.deletedCommentIds : [],
      deletedReportIds: Array.isArray(data.deletedReportIds) ? data.deletedReportIds : [],
      deletedBanIds: Array.isArray(data.deletedBanIds) ? data.deletedBanIds : [],
      deletedAccountIds: Array.isArray(data.deletedAccountIds) ? data.deletedAccountIds : [],
      friendRequests: Array.isArray(data.friendRequests) ? data.friendRequests : [],
      friendships: Array.isArray(data.friendships) ? data.friendships : [],
      directMessages: data.directMessages && typeof data.directMessages === "object" && !Array.isArray(data.directMessages) ? data.directMessages : {},
      boardPosts: Array.isArray(data.boardPosts) ? data.boardPosts : [],
      lobbyMessages: Array.isArray(data.lobbyMessages) ? data.lobbyMessages : [],
      reports: Array.isArray(data.reports) ? data.reports : [],
      bans: Array.isArray(data.bans) ? data.bans : [],
      userAccounts: Array.isArray(data.userAccounts) ? data.userAccounts : []
    };
  } catch {
    return defaultData();
  }
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

function normalizeInput(input = {}) {
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

function mergeState(current, incoming = {}) {
  const normalizedIncoming = normalizeInput(incoming);
  const deletedRecruitIds = [...new Set([...(current.deletedRecruitIds || []), ...normalizedIncoming.deletedRecruitIds])];
  const deletedRoomIds = [...new Set([...(current.deletedRoomIds || []), ...normalizedIncoming.deletedRoomIds])];
  const deletedBoardPostIds = [...new Set([...(current.deletedBoardPostIds || []), ...normalizedIncoming.deletedBoardPostIds])];
  const deletedCommentIds = [...new Set([...(current.deletedCommentIds || []), ...normalizedIncoming.deletedCommentIds])];
  const deletedReportIds = [...new Set([...(current.deletedReportIds || []), ...normalizedIncoming.deletedReportIds])];
  const deletedBanIds = [...new Set([...(current.deletedBanIds || []), ...normalizedIncoming.deletedBanIds])];
  const deletedAccountIds = [...new Set([...(current.deletedAccountIds || []), ...normalizedIncoming.deletedAccountIds])];
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

function writeDatabase(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        req.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleApi(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});
  if (req.method === "GET") return sendJson(res, 200, readDatabase());
  if (req.method !== "PUT") return sendJson(res, 405, { error: "Method not allowed" });

  try {
    const input = JSON.parse(await readBody(req));
    const nextData = mergeState(readDatabase(), input);
    writeDatabase(nextData);
    return sendJson(res, 200, nextData);
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON" });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(ROOT, requestedPath));
  const relativePath = path.relative(ROOT, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }

    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/state")) return handleApi(req, res);
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`PartyUp server running at http://localhost:${PORT}`);
});
