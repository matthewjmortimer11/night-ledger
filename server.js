"use strict";

const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const path = require("path");
const { promisify } = require("util");

const PORT = Number(process.env.PORT || 8124);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const DATABASE_PATH = process.env.NIGHT_LEDGER_DB || path.join(ROOT, "data", "night-ledger-db.json");
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const scrypt = promisify(crypto.scrypt);
const sessions = new Map();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json"
};

let database = { users: [], groups: [] };

function id(prefix) {
  return prefix + "-" + crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanName(value, max = 80) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function publicUser(user) {
  return { id: user.id, displayName: user.displayName, email: user.email };
}

function groupSummary(group) {
  return {
    id: group.id,
    name: group.name,
    inviteCode: group.inviteCode,
    ownerId: group.ownerId,
    memberCount: group.members.length,
    updatedAt: group.updatedAt
  };
}

async function loadDatabase() {
  try {
    const data = JSON.parse(await fsp.readFile(DATABASE_PATH, "utf8"));
    database = {
      users: Array.isArray(data.users) ? data.users : [],
      groups: Array.isArray(data.groups) ? data.groups : []
    };
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("Starting with an empty database:", error.message);
    await persistDatabase();
  }
}

async function persistDatabase() {
  await fsp.mkdir(path.dirname(DATABASE_PATH), { recursive: true });
  const temporaryPath = DATABASE_PATH + ".tmp";
  await fsp.writeFile(temporaryPath, JSON.stringify(database, null, 2), "utf8");
  await fsp.rename(temporaryPath, DATABASE_PATH);
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return separator < 0 ? [part, ""] : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      })
  );
}

function sessionFor(request) {
  const token = parseCookies(request).night_ledger_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = database.users.find((entry) => entry.id === session.userId);
  return user ? { token, user } : null;
}

function setSession(response, user) {
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
  response.setHeader(
    "Set-Cookie",
    "night_ledger_session=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + Math.floor(SESSION_TTL_MS / 1000)
  );
}

function clearSession(response) {
  response.setHeader("Set-Cookie", "night_ledger_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

function send(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, status, message) {
  send(response, status, { error: message });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON request."));
      }
    });
    request.on("error", reject);
  });
}

async function passwordHash(password, salt) {
  return (await scrypt(password, salt, 64)).toString("base64");
}

function validPassword(password) {
  return typeof password === "string" && password.length >= 8 && password.length <= 200;
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 7 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  } while (database.groups.some((group) => group.inviteCode === code));
  return code;
}

function memberGroup(user, groupId) {
  const group = database.groups.find((entry) => entry.id === groupId);
  return group && group.members.includes(user.id) ? group : null;
}

function requireUser(request, response) {
  const session = sessionFor(request);
  if (!session) {
    sendError(response, 401, "Sign in first.");
    return null;
  }
  return session.user;
}

async function handleApi(request, response, url) {
  const { pathname } = url;
  const method = request.method || "GET";

  if (method === "GET" && pathname === "/api/session") {
    const session = sessionFor(request);
    return send(response, 200, { user: session ? publicUser(session.user) : null });
  }

  if (method === "POST" && pathname === "/api/auth/signup") {
    const body = await readBody(request);
    const displayName = cleanName(body.displayName, 50);
    const email = cleanEmail(body.email);
    if (displayName.length < 2) return sendError(response, 400, "Choose a display name with at least two characters.");
    if (!validEmail(email)) return sendError(response, 400, "Enter a valid email address.");
    if (!validPassword(body.password)) return sendError(response, 400, "Use a password with at least eight characters.");
    if (database.users.some((user) => user.email === email)) return sendError(response, 409, "An account already exists for that email.");

    const salt = crypto.randomBytes(16).toString("base64");
    const user = {
      id: id("user"),
      displayName,
      email,
      passwordSalt: salt,
      passwordHash: await passwordHash(body.password, salt),
      createdAt: now()
    };
    database.users.push(user);
    await persistDatabase();
    setSession(response, user);
    return send(response, 201, { user: publicUser(user) });
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await readBody(request);
    const email = cleanEmail(body.email);
    const user = database.users.find((entry) => entry.email === email);
    if (!user || !validPassword(body.password)) return sendError(response, 401, "Email or password is incorrect.");
    const candidateHash = await passwordHash(body.password, user.passwordSalt);
    const equal = crypto.timingSafeEqual(Buffer.from(candidateHash), Buffer.from(user.passwordHash));
    if (!equal) return sendError(response, 401, "Email or password is incorrect.");
    setSession(response, user);
    return send(response, 200, { user: publicUser(user) });
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const session = sessionFor(request);
    if (session) sessions.delete(session.token);
    clearSession(response);
    return send(response, 200, { ok: true });
  }

  const user = requireUser(request, response);
  if (!user) return;

  if (method === "GET" && pathname === "/api/groups") {
    const groups = database.groups.filter((group) => group.members.includes(user.id)).map(groupSummary);
    return send(response, 200, { groups });
  }

  if (method === "POST" && pathname === "/api/groups") {
    const body = await readBody(request);
    const name = cleanName(body.name, 80);
    if (name.length < 2) return sendError(response, 400, "Give the group a name with at least two characters.");
    if (!body.ledger || typeof body.ledger !== "object" || Array.isArray(body.ledger)) {
      return sendError(response, 400, "A starting Night Ledger is required.");
    }
    const group = {
      id: id("group"),
      name,
      inviteCode: createInviteCode(),
      ownerId: user.id,
      members: [user.id],
      ledger: body.ledger,
      updatedAt: now(),
      createdAt: now()
    };
    database.groups.push(group);
    await persistDatabase();
    return send(response, 201, { group: groupSummary(group), ledger: group.ledger });
  }

  if (method === "POST" && pathname === "/api/groups/join") {
    const body = await readBody(request);
    const inviteCode = String(body.inviteCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const group = database.groups.find((entry) => entry.inviteCode === inviteCode);
    if (!group) return sendError(response, 404, "That invite code was not found.");
    if (!group.members.includes(user.id)) {
      group.members.push(user.id);
      group.updatedAt = now();
      await persistDatabase();
    }
    return send(response, 200, { group: groupSummary(group), ledger: group.ledger });
  }

  const ledgerMatch = pathname.match(/^\/api\/groups\/([^/]+)\/ledger$/);
  if (ledgerMatch) {
    const group = memberGroup(user, ledgerMatch[1]);
    if (!group) return sendError(response, 403, "You do not have access to this group.");
    if (method === "GET") return send(response, 200, { group: groupSummary(group), ledger: group.ledger });
    if (method === "PUT") {
      const body = await readBody(request);
      if (!body.ledger || typeof body.ledger !== "object" || Array.isArray(body.ledger)) {
        return sendError(response, 400, "The ledger data is invalid.");
      }
      group.ledger = body.ledger;
      group.updatedAt = now();
      await persistDatabase();
      return send(response, 200, { group: groupSummary(group), updatedAt: group.updatedAt });
    }
  }

  return sendError(response, 404, "API endpoint not found.");
}

async function serveStatic(request, response, url) {
  let requestedPath = decodeURIComponent(url.pathname);
  if (requestedPath === "/") requestedPath = "/index.html";
  const filePath = path.resolve(ROOT, "." + requestedPath);
  if (!filePath.startsWith(ROOT + path.sep)) return sendError(response, 403, "Forbidden.");
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return sendError(response, 404, "Not found.");
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": path.extname(filePath) === ".html" ? "no-cache" : "public, max-age=300"
    });
    fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT") return sendError(response, 404, "Not found.");
    console.error(error);
    return sendError(response, 500, "Could not serve this file.");
  }
}

async function requestHandler(request, response) {
  try {
    const url = new URL(request.url, "http://" + request.headers.host);
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
    return await serveStatic(request, response, url);
  } catch (error) {
    console.error(error);
    return sendError(response, 400, error.message || "Request could not be completed.");
  }
}

loadDatabase()
  .then(() => {
    http.createServer(requestHandler).listen(PORT, HOST, () => {
      console.log("Night Ledger shared app running at http://" + HOST + ":" + PORT);
    });
  })
  .catch((error) => {
    console.error("Night Ledger could not start:", error);
    process.exitCode = 1;
  });
