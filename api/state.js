const APP_STATE_ID = "partyup";
const REDIS_KEY = "partyup:state";

function defaultData() {
  return { recruits: [], boardPosts: [], lobbyMessages: [], reports: [], bans: [] };
}

function normalizeData(input = {}) {
  return {
    recruits: Array.isArray(input.recruits) ? input.recruits : [],
    boardPosts: Array.isArray(input.boardPosts) ? input.boardPosts : [],
    lobbyMessages: Array.isArray(input.lobbyMessages) ? input.lobbyMessages : [],
    reports: Array.isArray(input.reports) ? input.reports : [],
    bans: Array.isArray(input.bans) ? input.bans : []
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
  const nextData = normalizeData(data);
  await redisCommand(`set/${encodeURIComponent(REDIS_KEY)}/${encodeURIComponent(JSON.stringify(nextData))}`);
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

  const nextData = normalizeData(input);
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
