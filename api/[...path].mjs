import crypto from "node:crypto";
import { get, head, put } from "@vercel/blob";

const DATABASE_PATH = "night-ledger/private/database.json";
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function id(prefix) {
  return prefix + "-" + crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function emptyDatabase() {
  return { users: [], groups: [], sessions: [] };
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

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function error(status, message) {
  return json({ error: message }, status);
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.get("cookie") || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return separator < 0 ? [part, ""] : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      })
  );
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sessionCookie(token) {
  return "night_ledger_session=" + token
    + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + Math.floor(SESSION_TTL_MS / 1000);
}

function expiredCookie() {
  return "night_ledger_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

async function passwordHash(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (failure, derived) => {
      if (failure) reject(failure);
      else resolve(derived.toString("base64"));
    });
  });
}

function validPassword(password) {
  return typeof password === "string" && password.length >= 8 && password.length <= 200;
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createInviteCode(database) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 7 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  } while (database.groups.some((group) => group.inviteCode === code));
  return code;
}

function blobUnavailable() {
  return !process.env.BLOB_READ_WRITE_TOKEN;
}

async function readDatabase() {
  if (blobUnavailable()) throw new ApiError(503, "Shared storage is not connected to this deployment yet.");
  try {
    const metadata = await head(DATABASE_PATH);
    const blob = await get(DATABASE_PATH, { access: "private" });
    const body = await new Response(blob.stream).text();
    const database = JSON.parse(body);
    return {
      database: {
        users: Array.isArray(database.users) ? database.users : [],
        groups: Array.isArray(database.groups) ? database.groups : [],
        sessions: Array.isArray(database.sessions) ? database.sessions : []
      },
      etag: metadata.etag
    };
  } catch (caught) {
    if (caught?.name === "BlobNotFoundError" || caught?.code === "BlobNotFound") {
      return { database: emptyDatabase(), etag: null };
    }
    throw caught;
  }
}

async function writeDatabase(database, etag) {
  const options = {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  };
  if (etag) options.ifMatch = etag;
  return put(DATABASE_PATH, JSON.stringify(database), options);
}

function isConflict(caught) {
  return caught?.name === "BlobPreconditionFailedError" || caught?.code === "BlobPreconditionFailed";
}

async function mutateDatabase(mutator) {
  let lastConflict = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const snapshot = await readDatabase();
    const result = await mutator(snapshot.database);
    try {
      await writeDatabase(snapshot.database, snapshot.etag);
      return result;
    } catch (caught) {
      if (!isConflict(caught)) throw caught;
      lastConflict = caught;
    }
  }
  throw lastConflict || new ApiError(409, "The shared ledger changed. Please try again.");
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) throw new ApiError(413, "Request is too large.");
  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new ApiError(413, "Request is too large.");
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new ApiError(400, "Invalid JSON request.");
  }
}

function findUserBySession(database, request) {
  const token = parseCookies(request).night_ledger_session;
  if (!token) return null;
  const hash = tokenHash(token);
  const session = database.sessions.find((entry) => entry.tokenHash === hash);
  if (!session || Date.parse(session.expiresAt) < Date.now()) return null;
  const user = database.users.find((entry) => entry.id === session.userId);
  return user ? { user, tokenHash: hash } : null;
}

function requireUser(database, request) {
  const session = findUserBySession(database, request);
  if (!session) throw new ApiError(401, "Sign in first.");
  return session;
}

function requireMember(database, user, groupId) {
  const group = database.groups.find((entry) => entry.id === groupId);
  if (!group || !group.members.includes(user.id)) throw new ApiError(403, "You do not have access to this group.");
  return group;
}

async function handle(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === "GET" && path === "/api/session") {
    if (blobUnavailable()) return json({ user: null });
    const { database } = await readDatabase();
    const session = findUserBySession(database, request);
    return json({ user: session ? publicUser(session.user) : null });
  }

  if (method === "POST" && path === "/api/auth/signup") {
    const body = await readJson(request);
    const displayName = cleanName(body.displayName, 50);
    const email = cleanEmail(body.email);
    if (displayName.length < 2) throw new ApiError(400, "Choose a display name with at least two characters.");
    if (!validEmail(email)) throw new ApiError(400, "Enter a valid email address.");
    if (!validPassword(body.password)) throw new ApiError(400, "Use a password with at least eight characters.");
    const result = await mutateDatabase(async (database) => {
      if (database.users.some((user) => user.email === email)) throw new ApiError(409, "An account already exists for that email.");
      const passwordSalt = crypto.randomBytes(16).toString("base64");
      const user = {
        id: id("user"),
        displayName,
        email,
        passwordSalt,
        passwordHash: await passwordHash(body.password, passwordSalt),
        createdAt: now()
      };
      const token = crypto.randomBytes(32).toString("base64url");
      database.users.push(user);
      database.sessions.push({
        tokenHash: tokenHash(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
      });
      return { user, token };
    });
    return json({ user: publicUser(result.user) }, 201, { "Set-Cookie": sessionCookie(result.token) });
  }

  if (method === "POST" && path === "/api/auth/login") {
    const body = await readJson(request);
    const email = cleanEmail(body.email);
    const result = await mutateDatabase(async (database) => {
      const user = database.users.find((entry) => entry.email === email);
      if (!user || !validPassword(body.password)) throw new ApiError(401, "Email or password is incorrect.");
      const candidate = await passwordHash(body.password, user.passwordSalt);
      const valid = crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(user.passwordHash));
      if (!valid) throw new ApiError(401, "Email or password is incorrect.");
      const token = crypto.randomBytes(32).toString("base64url");
      database.sessions = database.sessions.filter((session) => Date.parse(session.expiresAt) > Date.now());
      database.sessions.push({
        tokenHash: tokenHash(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
      });
      return { user, token };
    });
    return json({ user: publicUser(result.user) }, 200, { "Set-Cookie": sessionCookie(result.token) });
  }

  if (method === "POST" && path === "/api/auth/logout") {
    if (!blobUnavailable()) {
      await mutateDatabase((database) => {
        const token = parseCookies(request).night_ledger_session;
        if (token) database.sessions = database.sessions.filter((session) => session.tokenHash !== tokenHash(token));
        return null;
      });
    }
    return json({ ok: true }, 200, { "Set-Cookie": expiredCookie() });
  }

  if (method === "GET" && path === "/api/groups") {
    const { database } = await readDatabase();
    const { user } = requireUser(database, request);
    return json({ groups: database.groups.filter((group) => group.members.includes(user.id)).map(groupSummary) });
  }

  if (method === "POST" && path === "/api/groups") {
    const body = await readJson(request);
    const name = cleanName(body.name, 80);
    if (name.length < 2) throw new ApiError(400, "Give the group a name with at least two characters.");
    if (!body.ledger || typeof body.ledger !== "object" || Array.isArray(body.ledger)) {
      throw new ApiError(400, "A starting Night Ledger is required.");
    }
    const result = await mutateDatabase((database) => {
      const { user } = requireUser(database, request);
      const group = {
        id: id("group"),
        name,
        inviteCode: createInviteCode(database),
        ownerId: user.id,
        members: [user.id],
        ledger: body.ledger,
        createdAt: now(),
        updatedAt: now()
      };
      database.groups.push(group);
      return group;
    });
    return json({ group: groupSummary(result), ledger: result.ledger }, 201);
  }

  if (method === "POST" && path === "/api/groups/join") {
    const body = await readJson(request);
    const inviteCode = String(body.inviteCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const result = await mutateDatabase((database) => {
      const { user } = requireUser(database, request);
      const group = database.groups.find((entry) => entry.inviteCode === inviteCode);
      if (!group) throw new ApiError(404, "That invite code was not found.");
      if (!group.members.includes(user.id)) {
        group.members.push(user.id);
        group.updatedAt = now();
      }
      return group;
    });
    return json({ group: groupSummary(result), ledger: result.ledger });
  }

  const ledgerMatch = path.match(/^\/api\/groups\/([^/]+)\/ledger$/);
  if (ledgerMatch && method === "GET") {
    const { database } = await readDatabase();
    const { user } = requireUser(database, request);
    const group = requireMember(database, user, ledgerMatch[1]);
    return json({ group: groupSummary(group), ledger: group.ledger });
  }

  if (ledgerMatch && method === "PUT") {
    const body = await readJson(request);
    if (!body.ledger || typeof body.ledger !== "object" || Array.isArray(body.ledger)) {
      throw new ApiError(400, "The ledger data is invalid.");
    }
    const result = await mutateDatabase((database) => {
      const { user } = requireUser(database, request);
      const group = requireMember(database, user, ledgerMatch[1]);
      group.ledger = body.ledger;
      group.updatedAt = now();
      return group;
    });
    return json({ group: groupSummary(result), updatedAt: result.updatedAt });
  }

  throw new ApiError(404, "API endpoint not found.");
}

export default {
  async fetch(request) {
    try {
      return await handle(request);
    } catch (caught) {
      if (caught instanceof ApiError) return error(caught.status, caught.message);
      console.error(caught);
      return error(500, "The server could not complete that request.");
    }
  }
};
