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
  return { recruits: [], rooms: {}, boardPosts: [], lobbyMessages: [], reports: [], bans: [] };
}

function readDatabase() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    return {
      recruits: Array.isArray(data.recruits) ? data.recruits : [],
      rooms: data.rooms && typeof data.rooms === "object" && !Array.isArray(data.rooms) ? data.rooms : {},
      boardPosts: Array.isArray(data.boardPosts) ? data.boardPosts : [],
      lobbyMessages: Array.isArray(data.lobbyMessages) ? data.lobbyMessages : [],
      reports: Array.isArray(data.reports) ? data.reports : [],
      bans: Array.isArray(data.bans) ? data.bans : []
    };
  } catch {
    return defaultData();
  }
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
    const nextData = {
      recruits: Array.isArray(input.recruits) ? input.recruits : [],
      rooms: input.rooms && typeof input.rooms === "object" && !Array.isArray(input.rooms) ? input.rooms : {},
      boardPosts: Array.isArray(input.boardPosts) ? input.boardPosts : [],
      lobbyMessages: Array.isArray(input.lobbyMessages) ? input.lobbyMessages : [],
      reports: Array.isArray(input.reports) ? input.reports : [],
      bans: Array.isArray(input.bans) ? input.bans : []
    };
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
