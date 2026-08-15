var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => VpsSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/activity.ts
var MAX_ACTIVITY_ENTRIES = 200;
var REPEAT_WINDOW_MS = 6e4;
function appendActivity(entries, level, message, timestamp = Date.now()) {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) return entries;
  const previous = entries.at(-1);
  if (previous && previous.level === level && previous.message === trimmedMessage && timestamp - previous.timestamp <= REPEAT_WINDOW_MS) {
    return [
      ...entries.slice(0, -1),
      {
        ...previous,
        timestamp,
        count: previous.count + 1
      }
    ];
  }
  return [
    ...entries,
    {
      timestamp,
      level,
      message: trimmedMessage,
      count: 1
    }
  ].slice(-MAX_ACTIVITY_ENTRIES);
}
function describeReport(report) {
  const parts = [
    `\u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E ${report.uploaded}`,
    `\u043F\u043E\u043B\u0443\u0447\u0435\u043D\u043E ${report.downloaded}`,
    `\u0443\u0434\u0430\u043B\u0435\u043D\u043E \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E ${report.deletedLocal}`,
    `\u0443\u0434\u0430\u043B\u0435\u043D\u043E \u043D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435 ${report.deletedRemote}`,
    `\u043A\u043E\u043D\u0444\u043B\u0438\u043A\u0442\u043E\u0432 ${report.conflicts}`
  ];
  if (report.skipped > 0) parts.push(`\u043F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u043E ${report.skipped}`);
  if (report.errors.length > 0) parts.push(`\u043E\u0448\u0438\u0431\u043E\u043A ${report.errors.length}`);
  return `VPS Sync: ${parts.join(", ")}`;
}
function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString("ru-RU");
}
function formatErrorReport(version, deviceName, errors, report) {
  const lines = [`VPS Sync ${version}`, `\u0423\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E: ${deviceName}`];
  if (report) {
    lines.push(`\u0412\u0440\u0435\u043C\u044F: ${formatTimestamp(report.finishedAt)}`);
    lines.push(describeReport(report));
  }
  lines.push("");
  if (errors.length === 0) {
    lines.push("\u041E\u0448\u0438\u0431\u043E\u043A \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0439 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0438 \u043D\u0435\u0442.");
  } else {
    lines.push(`\u041E\u0448\u0438\u0431\u043A\u0438 (${errors.length}):`);
    lines.push(...errors.map((error, index) => `${index + 1}. ${error}`));
  }
  return lines.join("\n");
}
function formatActivityLog(entries) {
  if (entries.length === 0) return "\u0416\u0443\u0440\u043D\u0430\u043B VPS Sync \u043F\u0443\u0441\u0442.";
  return entries.map((entry) => {
    const repeat = entry.count > 1 ? ` \xD7${entry.count}` : "";
    return `[${formatTimestamp(entry.timestamp)}] [${entry.level}]${repeat} ${entry.message}`;
  }).join("\n");
}

// src/encoding.ts
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function utf8(value) {
  return encoder.encode(value);
}
function decodeUtf8(value) {
  return decoder.decode(value);
}
function bytesToBase64(value) {
  let binary = "";
  const block = 32768;
  for (let offset = 0; offset < value.length; offset += block) {
    binary += String.fromCharCode(...value.subarray(offset, Math.min(offset + block, value.length)));
  }
  return btoa(binary);
}
function base64ToBytes(value) {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}
function bytesToBase64Url(value) {
  return bytesToBase64(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}
function toArrayBuffer(value) {
  return value.slice().buffer;
}

// src/crypto.ts
var PBKDF2_ITERATIONS = 31e4;
function createSalt() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(24)));
}
async function createCryptoContext(passphrase, saltBase64) {
  if (passphrase.length < 12) {
    throw new Error("\u041F\u0430\u0440\u043E\u043B\u044C \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u0434\u043E\u043B\u0436\u0435\u043D \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u0442\u044C \u043D\u0435 \u043C\u0435\u043D\u0435\u0435 12 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432");
  }
  const material = await crypto.subtle.importKey("raw", toArrayBuffer(utf8(passphrase)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(base64ToBytes(saltBase64)),
      iterations: PBKDF2_ITERATIONS
    },
    material,
    512
  );
  const bytes = new Uint8Array(bits);
  const aesKey = await crypto.subtle.importKey("raw", bytes.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]);
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    bytes.slice(32, 64),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return { aesKey, hmacKey };
}
async function sha256(data) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToBase64Url(new Uint8Array(digest));
}
async function keyedId(context, namespace, value) {
  const signature = await crypto.subtle.sign("HMAC", context.hmacKey, toArrayBuffer(utf8(`${namespace}:${value}`)));
  return bytesToBase64Url(new Uint8Array(signature));
}
async function encryptBytes(context, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    context.aesKey,
    toArrayBuffer(value)
  );
  return {
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted))
  };
}
async function decryptBytes(context, value) {
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(value.iv)) },
      context.aesKey,
      toArrayBuffer(base64ToBytes(value.data))
    );
    return new Uint8Array(decrypted);
  } catch {
    throw new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u0430\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435: \u043F\u0430\u0440\u043E\u043B\u044C \u0438\u043B\u0438 \u0441\u043E\u043B\u044C \u043D\u0435 \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u044E\u0442");
  }
}
async function encryptJson(context, value) {
  return encryptBytes(context, utf8(JSON.stringify(value)));
}
async function decryptJson(context, value) {
  const bytes = await decryptBytes(context, value);
  return JSON.parse(decodeUtf8(toArrayBuffer(bytes)));
}

// src/defaults.ts
var DEFAULT_EXCLUDED_PATTERNS = [
  ".git/**",
  ".git",
  ".trash/**",
  ".trash",
  ".DS_Store",
  "Thumbs.db",
  ".obsidian/workspace.json",
  ".obsidian/workspace-mobile.json",
  ".obsidian/community-plugins.json",
  ".obsidian/plugins/vps-sync*/**",
  ".obsidian/plugins/vps-sync*"
];
function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function createDefaultSettings() {
  return {
    serverUrl: "",
    database: "vps-sync",
    username: "",
    password: "",
    encryptionPassphrase: "",
    encryptionSalt: createSalt(),
    deviceId: randomId(),
    deviceName: "\u0423\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E",
    syncIntervalSeconds: 30,
    scanIntervalSeconds: 300,
    maxFileSizeMb: 32,
    chunkSizeKb: 512,
    syncOnStart: true,
    paused: true,
    initialised: false,
    initialMode: "merge",
    extraExcludedPatterns: []
  };
}
function createDefaultData() {
  return {
    settings: createDefaultSettings(),
    state: {
      schema: 1,
      files: {},
      lastServerSequence: "",
      lastFullScanAt: 0,
      lastErrors: [],
      activityLog: []
    }
  };
}

// src/couch.ts
var import_obsidian = require("obsidian");
var VAULT_CONFIG_ID = "config:vps-sync";
var CouchError = class extends Error {
  constructor(message, status, responseText) {
    super(message);
    this.status = status;
    this.responseText = responseText;
  }
};
var CouchConflictError = class extends CouchError {
};
function wait(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
function stripTrailingSlash(value) {
  return value.replace(/\/+$/u, "");
}
var CouchClient = class {
  constructor(serverUrl, database, username, password, requester = import_obsidian.requestUrl) {
    this.serverUrl = serverUrl;
    this.database = database;
    this.username = username;
    this.password = password;
    this.requester = requester;
  }
  queue = Promise.resolve();
  databaseUrl(path = "") {
    const base = stripTrailingSlash(this.serverUrl);
    return `${base}/${encodeURIComponent(this.database)}${path}`;
  }
  authorisation() {
    return `Basic ${bytesToBase64(utf8(`${this.username}:${this.password}`))}`;
  }
  serial(operation) {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => void 0,
      () => void 0
    );
    return result;
  }
  async request(method, path, body, acceptedStatuses = [200, 201, 202]) {
    return this.serial(async () => {
      let lastError;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const response = await this.requester({
            url: this.databaseUrl(path),
            method,
            headers: {
              Authorization: this.authorisation(),
              Accept: "application/json"
            },
            contentType: "application/json",
            body: body === void 0 ? void 0 : JSON.stringify(body),
            throw: false
          });
          if (acceptedStatuses.includes(response.status)) return response.json;
          if (response.status === 409) {
            throw new CouchConflictError("\u0421\u0435\u0440\u0432\u0435\u0440\u043D\u0430\u044F \u0432\u0435\u0440\u0441\u0438\u044F \u0444\u0430\u0439\u043B\u0430 \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u0430\u0441\u044C \u0432\u043E \u0432\u0440\u0435\u043C\u044F \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0438", 409, response.text);
          }
          if (response.status >= 500 || response.status === 408 || response.status === 429) {
            throw new CouchError(`\u0412\u0440\u0435\u043C\u0435\u043D\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430 CouchDB: HTTP ${response.status}`, response.status, response.text);
          }
          throw new CouchError(`\u0417\u0430\u043F\u0440\u043E\u0441 CouchDB \u043E\u0442\u043A\u043B\u043E\u043D\u0451\u043D: HTTP ${response.status}`, response.status, response.text);
        } catch (error) {
          lastError = error;
          if (error instanceof CouchConflictError) throw error;
          if (error instanceof CouchError && error.status > 0 && error.status < 500 && error.status !== 408 && error.status !== 429) {
            throw error;
          }
          if (attempt < 3) await wait(750 * 2 ** attempt);
        }
      }
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      throw new CouchError(`\u0421\u0435\u0442\u0435\u0432\u043E\u0439 \u0437\u0430\u043F\u0440\u043E\u0441 \u043D\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D \u043F\u043E\u0441\u043B\u0435 \u0447\u0435\u0442\u044B\u0440\u0451\u0445 \u043F\u043E\u043F\u044B\u0442\u043E\u043A: ${message}`, 0, "");
    });
  }
  async ensureDatabase() {
    try {
      return await this.request("GET", "");
    } catch (error) {
      if (!(error instanceof CouchError) || error.status !== 404) throw error;
      await this.request("PUT", "", void 0, [201, 202]);
      return this.request("GET", "");
    }
  }
  async info() {
    return this.request("GET", "");
  }
  async fetchVaultConfig() {
    try {
      return await this.request("GET", `/${encodeURIComponent(VAULT_CONFIG_ID)}`);
    } catch (error) {
      if (error instanceof CouchError && error.status === 404) return null;
      throw error;
    }
  }
  async putVaultConfig(document) {
    const value = { _id: VAULT_CONFIG_ID, ...document };
    try {
      const response = await this.request("PUT", `/${encodeURIComponent(VAULT_CONFIG_ID)}`, value);
      return { ...value, _rev: response.rev };
    } catch (error) {
      if (!(error instanceof CouchConflictError)) throw error;
      const existing = await this.fetchVaultConfig();
      if (!existing) throw error;
      return existing;
    }
  }
  async hasHeadDocuments() {
    const startKey = encodeURIComponent(JSON.stringify("head:"));
    const endKey = encodeURIComponent(JSON.stringify("head:\uFFF0"));
    const response = await this.request(
      "GET",
      `/_all_docs?limit=1&startkey=${startKey}&endkey=${endKey}`
    );
    return response.rows.length > 0;
  }
  async fetchManifest(context) {
    const startKey = encodeURIComponent(JSON.stringify("head:"));
    const endKey = encodeURIComponent(JSON.stringify("head:\uFFF0"));
    const response = await this.request(
      "GET",
      `/_all_docs?include_docs=true&limit=10000&startkey=${startKey}&endkey=${endKey}`
    );
    const entries = /* @__PURE__ */ new Map();
    for (const row of response.rows) {
      if (!row.doc || row.doc.type !== "head" || !row.doc._rev) continue;
      const payload = await decryptJson(context, row.doc.value);
      const existing = entries.get(payload.pathKey);
      if (existing && existing.id !== row.doc._id) {
        throw new Error(`\u0421\u0435\u0440\u0432\u0435\u0440 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u0434\u0432\u0430 \u043F\u0443\u0442\u0438, \u0440\u0430\u0437\u043B\u0438\u0447\u0430\u044E\u0449\u0438\u0435\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u043E\u043C: ${existing.path} \u0438 ${payload.path}`);
      }
      entries.set(payload.pathKey, {
        ...payload,
        id: row.doc._id,
        rev: row.doc._rev
      });
    }
    return entries;
  }
  async putHead(context, payload, expectedRemote) {
    const id = `head:${await keyedId(context, "path", payload.pathKey)}`;
    const document = {
      _id: id,
      type: "head",
      value: await encryptJson(context, payload)
    };
    if (expectedRemote?.rev) document._rev = expectedRemote.rev;
    const response = await this.request("PUT", `/${encodeURIComponent(id)}`, document);
    return { ...payload, id: response.id, rev: response.rev };
  }
  async uploadBlob(blobKey, encryptedBase64, chunkSizeBytes) {
    const bytes = base64ToBytes(encryptedBase64);
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += chunkSizeBytes) {
      chunks.push(bytes.subarray(offset, Math.min(offset + chunkSizeBytes, bytes.length)));
    }
    if (chunks.length === 0) chunks.push(new Uint8Array());
    const ids = chunks.map((_, index) => this.blobDocumentId(blobKey, index));
    const existing = await this.request("POST", "/_all_docs", { keys: ids });
    const existingIds = new Set(existing.rows.filter((row) => !row.error && !row.value.error).map((row) => row.id));
    const missing = chunks.map((chunk, index) => ({
      _id: ids[index],
      type: "blob",
      data: bytesToBase64(chunk)
    })).filter((document) => !existingIds.has(document._id));
    for (let index = 0; index < missing.length; index += 8) {
      const batch = missing.slice(index, index + 8);
      const results = await this.request(
        "POST",
        "/_bulk_docs",
        { docs: batch }
      );
      const failed = results.find((result) => !result.ok && result.error !== "conflict");
      if (failed) throw new Error(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0447\u0430\u0441\u0442\u044C \u0444\u0430\u0439\u043B\u0430: ${failed.error ?? "\u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430"}`);
    }
    return chunks.length;
  }
  async downloadBlob(blobKey, chunkCount) {
    const ids = Array.from({ length: chunkCount }, (_, index) => this.blobDocumentId(blobKey, index));
    const chunks = [];
    for (let index = 0; index < ids.length; index += 16) {
      const batchIds = ids.slice(index, index + 16);
      const response = await this.request("POST", "/_all_docs?include_docs=true", {
        keys: batchIds
      });
      for (const row of response.rows) {
        if (!row.doc || row.doc.type !== "blob") throw new Error(`\u041D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435 \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u0447\u0430\u0441\u0442\u044C \u0444\u0430\u0439\u043B\u0430: ${row.key}`);
        chunks.push(base64ToBytes(row.doc.data));
      }
    }
    return bytesToBase64(concatBytes(chunks));
  }
  blobDocumentId(blobKey, index) {
    return `blob:${blobKey}:${index.toString().padStart(6, "0")}`;
  }
};

// src/path-rules.ts
function normaliseRelativePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/{2,}/gu, "/").replace(/\/$/u, "").normalize("NFC");
}
function pathKey(path) {
  return normaliseRelativePath(path).toLocaleLowerCase("en-US");
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function globToRegExp(pattern) {
  const normalised = normaliseRelativePath(pattern);
  let source = "";
  for (let index = 0; index < normalised.length; index += 1) {
    const character = normalised[index];
    const next = normalised[index + 1];
    if (character === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(character);
    }
  }
  return new RegExp(`^${source}$`, "iu");
}
var PathRules = class {
  expressions;
  constructor(extraPatterns) {
    this.expressions = [...DEFAULT_EXCLUDED_PATTERNS, ...extraPatterns].map((pattern) => pattern.trim()).filter(Boolean).map(globToRegExp);
  }
  isExcluded(path) {
    const normalised = normaliseRelativePath(path);
    return normalised.length === 0 || this.expressions.some((expression) => expression.test(normalised));
  }
};
function parentPaths(path) {
  const parts = normaliseRelativePath(path).split("/");
  const result = [];
  for (let index = 1; index < parts.length; index += 1) {
    result.push(parts.slice(0, index).join("/"));
  }
  return result;
}
function conflictPath(path, deviceName, now = /* @__PURE__ */ new Date()) {
  const safeDevice = deviceName.replace(/[\\/:*?"<>|]/gu, "-").trim() || "\u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E";
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  const slash = path.lastIndexOf("/");
  const directory = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return `${directory}${name} (\u043A\u043E\u043D\u0444\u043B\u0438\u043A\u0442 ${safeDevice} ${stamp})`;
  }
  return `${directory}${name.slice(0, dot)} (\u043A\u043E\u043D\u0444\u043B\u0438\u043A\u0442 ${safeDevice} ${stamp})${name.slice(dot)}`;
}
function caseCollisionPath(path, sequence = 1) {
  const normalised = normaliseRelativePath(path);
  const slash = normalised.lastIndexOf("/");
  const directory = slash >= 0 ? normalised.slice(0, slash + 1) : "";
  const name = slash >= 0 ? normalised.slice(slash + 1) : normalised;
  const dot = name.lastIndexOf(".");
  const suffix = sequence === 1 ? " (\u0440\u0430\u0437\u043B\u0438\u0447\u0438\u0435 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430)" : ` (\u0440\u0430\u0437\u043B\u0438\u0447\u0438\u0435 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430 ${sequence})`;
  if (dot <= 0) return `${directory}${name}${suffix}`;
  return `${directory}${name.slice(0, dot)}${suffix}${name.slice(dot)}`;
}

// src/reconcile.ts
var DELETED_TOKEN = "deleted";
var FOLDER_TOKEN = "folder";
function localToken(entry) {
  if (!entry) return DELETED_TOKEN;
  if (entry.kind === "folder") return FOLDER_TOKEN;
  if (!entry.hash) throw new Error(`\u041D\u0435 \u0432\u044B\u0447\u0438\u0441\u043B\u0435\u043D\u0430 \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044C\u043D\u0430\u044F \u0441\u0443\u043C\u043C\u0430 \u0444\u0430\u0439\u043B\u0430: ${entry.path}`);
  return `file:${entry.hash}`;
}
function remoteToken(entry) {
  if (!entry || entry.deleted) return DELETED_TOKEN;
  if (entry.kind === "folder") return FOLDER_TOKEN;
  if (!entry.contentHash) throw new Error(`\u041D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435 \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044C\u043D\u0430\u044F \u0441\u0443\u043C\u043C\u0430 \u0444\u0430\u0439\u043B\u0430: ${entry.path}`);
  return `file:${entry.contentHash}`;
}
function isMirroredPluginPath(key) {
  return key.startsWith(".obsidian/plugins/") && !key.startsWith(".obsidian/plugins/vps-sync/");
}
function missingRemotePlugin(local) {
  return {
    schema: 1,
    id: "",
    rev: "",
    path: local.path,
    pathKey: local.pathKey,
    kind: local.kind,
    deleted: true,
    size: 0,
    mtime: Date.now(),
    deviceId: "",
    deviceName: "",
    updatedAt: Date.now()
  };
}
function firstSyncAction(pathKey2, local, remote, mode) {
  const hasLocal = local !== void 0;
  const hasRemote = remote !== void 0 && !remote.deleted;
  if (!hasLocal && !hasRemote) return { type: "equal", pathKey: pathKey2 };
  if (hasLocal && !hasRemote) return { type: "upload", pathKey: pathKey2, local, remote };
  if (!hasLocal && hasRemote) return { type: "download", pathKey: pathKey2, remote };
  if (!local || !remote) return { type: "equal", pathKey: pathKey2 };
  if (localToken(local) === remoteToken(remote)) return { type: "equal", pathKey: pathKey2 };
  if (mode === "prefer-local") return { type: "upload", pathKey: pathKey2, local, remote };
  if (mode === "prefer-remote") return { type: "download", pathKey: pathKey2, remote, local };
  return { type: "conflict", pathKey: pathKey2, local, remote };
}
function decideAction(pathKey2, local, remote, previous, mode) {
  if (mode === "prefer-local" && local?.kind === "file" && remote?.kind === "file" && !remote.deleted && remote.blobVersion !== 2) {
    return { type: "upload", pathKey: pathKey2, local, remote };
  }
  if (!previous && mode === "prefer-remote" && local && (!remote || remote.deleted) && isMirroredPluginPath(pathKey2)) {
    return { type: "delete-local", pathKey: pathKey2, remote: remote ?? missingRemotePlugin(local), local };
  }
  if (!previous) return firstSyncAction(pathKey2, local, remote, mode);
  if (!remote) {
    if (local) return { type: "upload", pathKey: pathKey2, local };
    return { type: "equal", pathKey: pathKey2 };
  }
  const base = previous.token;
  const currentLocal = localToken(local);
  const currentRemote = remoteToken(remote);
  if (currentLocal === currentRemote) return { type: "equal", pathKey: pathKey2 };
  if (currentLocal === base && currentRemote !== base) {
    if (!remote || remote.deleted) {
      if (!local) return { type: "equal", pathKey: pathKey2 };
      return { type: "delete-local", pathKey: pathKey2, remote: remote ?? tombstoneFromState(previous), local };
    }
    return { type: "download", pathKey: pathKey2, remote, local };
  }
  if (currentRemote === base && currentLocal !== base) {
    if (!local) return { type: "upload-delete", pathKey: pathKey2, previous, remote };
    return { type: "upload", pathKey: pathKey2, local, remote };
  }
  if (!local && remote && !remote.deleted) {
    return { type: "download", pathKey: pathKey2, remote };
  }
  if (local && (!remote || remote.deleted)) {
    if (currentLocal === base) {
      return { type: "delete-local", pathKey: pathKey2, remote: remote ?? tombstoneFromState(previous), local };
    }
    return { type: "conflict", pathKey: pathKey2, local, remote: remote ?? tombstoneFromState(previous) };
  }
  if (local && remote) return { type: "conflict", pathKey: pathKey2, local, remote };
  return { type: "equal", pathKey: pathKey2 };
}
function tombstoneFromState(previous) {
  return {
    schema: 1,
    id: "",
    rev: previous.remoteRev ?? "",
    path: previous.path,
    pathKey: previous.path.toLocaleLowerCase("en-US"),
    kind: previous.kind,
    deleted: true,
    size: 0,
    mtime: Date.now(),
    deviceId: "",
    deviceName: "",
    updatedAt: Date.now()
  };
}
function buildActions(localEntries, remoteEntries, previousFiles, mode) {
  const keys = /* @__PURE__ */ new Set([...localEntries.keys(), ...remoteEntries.keys(), ...Object.keys(previousFiles)]);
  return [...keys].map((key) => decideAction(key, localEntries.get(key), remoteEntries.get(key), previousFiles[key], mode)).sort((left, right) => {
    const leftDepth = left.pathKey.split("/").length;
    const rightDepth = right.pathKey.split("/").length;
    const leftDeletes = left.type === "delete-local" || left.type === "upload-delete";
    const rightDeletes = right.type === "delete-local" || right.type === "upload-delete";
    if (leftDeletes !== rightDeletes) return leftDeletes ? -1 : 1;
    if (leftDeletes && rightDeletes) return rightDepth - leftDepth;
    return leftDepth - rightDepth;
  });
}

// src/local-vault.ts
function asFileSystemAdapter(app) {
  return app.vault.adapter;
}
var LocalVault = class {
  constructor(app, rules, maxFileSizeBytes) {
    this.rules = rules;
    this.maxFileSizeBytes = maxFileSizeBytes;
    this.adapter = asFileSystemAdapter(app);
  }
  adapter;
  async scan(previousFiles) {
    const entries = /* @__PURE__ */ new Map();
    const skipped = [];
    const renamedCaseCollisions = [];
    const pending = [""];
    while (pending.length > 0) {
      const base = pending.shift() ?? "";
      const listing = await this.adapter.list(base);
      for (const rawFolder of listing.folders) {
        let folder = normaliseRelativePath(rawFolder);
        if (this.rules.isExcluded(folder)) continue;
        const folderCollision = entries.get(pathKey(folder));
        if (folderCollision && folderCollision.path !== folder) {
          const original = folder;
          folder = await this.renameCaseCollision(folder, entries);
          renamedCaseCollisions.push(`${original} \u2192 ${folder}`);
        }
        this.addEntry(entries, {
          path: folder,
          pathKey: pathKey(folder),
          kind: "folder",
          size: 0,
          mtime: 0,
          hash: FOLDER_TOKEN
        });
        pending.push(folder);
      }
      for (const rawFile of listing.files) {
        let file = normaliseRelativePath(rawFile);
        if (this.rules.isExcluded(file)) continue;
        const fileCollision = entries.get(pathKey(file));
        if (fileCollision && fileCollision.path !== file) {
          const original = file;
          file = await this.renameCaseCollision(file, entries);
          renamedCaseCollisions.push(`${original} \u2192 ${file}`);
        }
        const stat = await this.adapter.stat(file);
        if (!stat || stat.type !== "file") continue;
        if (stat.size > this.maxFileSizeBytes) {
          skipped.push(`${file}: ${stat.size} \u0431\u0430\u0439\u0442`);
          continue;
        }
        const key = pathKey(file);
        const previous = previousFiles[key];
        let hash;
        if (previous?.kind === "file" && previous.localMtime === stat.mtime && previous.localSize === stat.size && previous.token.startsWith("file:")) {
          hash = previous.token.slice("file:".length);
        } else {
          hash = await this.hashFile(file);
        }
        this.addEntry(entries, {
          path: file,
          pathKey: key,
          kind: "file",
          size: stat.size,
          mtime: stat.mtime,
          hash
        });
      }
    }
    return { entries, skipped, renamedCaseCollisions };
  }
  async renameCaseCollision(path, entries) {
    for (let sequence = 1; sequence < 1e4; sequence += 1) {
      const target = caseCollisionPath(path, sequence);
      if (!entries.has(pathKey(target)) && !await this.adapter.exists(target)) {
        await this.adapter.rename(path, target);
        return target;
      }
    }
    throw new Error(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u0434\u043E\u0431\u0440\u0430\u0442\u044C \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0435 \u0438\u043C\u044F \u0434\u043B\u044F \u043F\u0443\u0442\u0438: ${path}`);
  }
  addEntry(entries, entry) {
    const existing = entries.get(entry.pathKey);
    if (existing && existing.path !== entry.path) {
      throw new Error(`\u041D\u0430\u0439\u0434\u0435\u043D\u044B \u043F\u0443\u0442\u0438, \u0440\u0430\u0437\u043B\u0438\u0447\u0430\u044E\u0449\u0438\u0435\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u043E\u043C: ${existing.path} \u0438 ${entry.path}`);
    }
    entries.set(entry.pathKey, entry);
  }
  async read(path) {
    return new Uint8Array(await this.adapter.readBinary(path));
  }
  async hashFile(path) {
    const bytes = await this.read(path);
    return sha256(toArrayBuffer(bytes));
  }
  async ensureFolder(path) {
    for (const parent of [...parentPaths(path), normaliseRelativePath(path)]) {
      if (!await this.adapter.exists(parent)) await this.adapter.mkdir(parent);
    }
  }
  async write(path, data, mtime) {
    const parents = parentPaths(path);
    if (parents.length > 0) await this.ensureFolder(parents.at(-1) ?? "");
    const existing = await this.adapter.stat(path);
    if (existing?.type === "folder") {
      const listing = await this.adapter.list(path);
      if (listing.files.length > 0 || listing.folders.length > 0) {
        throw new Error(`\u041D\u0435\u043B\u044C\u0437\u044F \u0437\u0430\u043C\u0435\u043D\u0438\u0442\u044C \u043D\u0435\u043F\u0443\u0441\u0442\u0443\u044E \u043F\u0430\u043F\u043A\u0443 \u0444\u0430\u0439\u043B\u043E\u043C: ${path}`);
      }
      await this.adapter.rmdir(path, false);
    }
    const options = { mtime, ctime: mtime };
    await this.adapter.writeBinary(path, toArrayBuffer(data), options);
    return this.adapter.stat(path);
  }
  async remove(path) {
    const stat = await this.adapter.stat(path);
    if (!stat) return;
    if (stat.type === "folder") {
      const listing = await this.adapter.list(path);
      if (listing.files.length > 0 || listing.folders.length > 0) return;
      await this.adapter.rmdir(path, false);
      return;
    }
    await this.adapter.remove(path);
  }
  async moveToConflict(path, target) {
    const parents = parentPaths(target);
    if (parents.length > 0) await this.ensureFolder(parents.at(-1) ?? "");
    await this.adapter.rename(path, target);
  }
  async stat(path) {
    return this.adapter.stat(path);
  }
};

// src/engine.ts
function emptyReport() {
  const now = Date.now();
  return {
    startedAt: now,
    finishedAt: now,
    uploaded: 0,
    downloaded: 0,
    deletedLocal: 0,
    deletedRemote: 0,
    conflicts: 0,
    unchanged: 0,
    skipped: 0,
    errors: []
  };
}
var SyncEngine = class {
  constructor(app, data, callbacks) {
    this.app = app;
    this.data = data;
    this.callbacks = callbacks;
  }
  running = false;
  rerunRequested = false;
  localDirty = true;
  cryptoCache;
  isRunning() {
    return this.running;
  }
  requestAnotherRun() {
    this.rerunRequested = true;
  }
  markLocalDirty() {
    this.localDirty = true;
  }
  async testConnection() {
    this.validateSettings();
    const client = this.createClient();
    const info = await client.ensureDatabase();
    await this.prepareCrypto(client);
    return `\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E. \u0411\u0430\u0437\u0430: ${info.db_name}`;
  }
  async sync() {
    if (this.running) {
      this.rerunRequested = true;
      const report2 = emptyReport();
      report2.errors.push("\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u0443\u0436\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F; \u043D\u043E\u0432\u044B\u0439 \u0437\u0430\u043F\u0443\u0441\u043A \u043F\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C");
      return report2;
    }
    this.running = true;
    this.rerunRequested = false;
    let report = emptyReport();
    try {
      report = await this.runOnce();
    } finally {
      this.running = false;
      this.callbacks.status(this.data.settings.paused ? "\u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E" : "\u0433\u043E\u0442\u043E\u0432\u043E");
    }
    if (this.rerunRequested && !this.data.settings.paused) {
      this.rerunRequested = false;
      window.setTimeout(() => void this.sync(), 250);
    }
    return report;
  }
  async runOnce() {
    this.validateSettings();
    const report = emptyReport();
    const client = this.createClient();
    const rules = new PathRules(this.data.settings.extraExcludedPatterns);
    const localVault = new LocalVault(this.app, rules, this.data.settings.maxFileSizeMb * 1024 * 1024);
    this.callbacks.status("\u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430");
    const initialInfo = await client.ensureDatabase();
    const context = await this.prepareCrypto(client);
    const serverUnchanged = String(initialInfo.update_seq) === this.data.state.lastServerSequence;
    const scanStillFresh = Date.now() - this.data.state.lastFullScanAt < this.data.settings.scanIntervalSeconds * 1e3;
    if (this.data.settings.initialised && !this.localDirty && serverUnchanged && scanStillFresh) {
      report.finishedAt = Date.now();
      report.unchanged = 1;
      return report;
    }
    this.callbacks.status("\u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0430");
    const localScan = await localVault.scan(this.data.state.files);
    report.skipped = localScan.skipped.length;
    if (localScan.skipped.length > 0) {
      this.callbacks.log(`\u041F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u044B \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u0438\u0435 \u0444\u0430\u0439\u043B\u044B: ${localScan.skipped.join(", ")}`);
    }
    if (localScan.renamedCaseCollisions.length > 0) {
      report.conflicts += localScan.renamedCaseCollisions.length;
      this.callbacks.log(
        `\u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u0435\u0440\u0435\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u044B \u043F\u0443\u0442\u0438, \u0440\u0430\u0437\u043B\u0438\u0447\u0430\u0432\u0448\u0438\u0435\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u043E\u043C: ${localScan.renamedCaseCollisions.join(", ")}`
      );
    }
    this.callbacks.status("\u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u0435 \u0441\u043F\u0438\u0441\u043A\u0430 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439");
    const remoteEntries = await client.fetchManifest(context);
    const actions = buildActions(
      localScan.entries,
      remoteEntries,
      this.data.state.files,
      this.data.settings.initialised ? "merge" : this.data.settings.initialMode
    );
    let completedSinceSave = 0;
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      this.callbacks.status(`${index + 1}/${actions.length}: ${this.actionPath(action)}`);
      try {
        await this.executeAction(action, client, localVault, context, report, remoteEntries, localScan.entries);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.errors.push(`${this.actionPath(action)}: ${message}`);
        this.callbacks.log(`\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0438 ${this.actionPath(action)}`, error);
        if (error instanceof CouchConflictError) {
          this.rerunRequested = true;
          break;
        }
        if (error instanceof CouchError) break;
      }
      completedSinceSave += 1;
      if (completedSinceSave >= 20) {
        await this.callbacks.save();
        completedSinceSave = 0;
      }
    }
    const info = await client.info();
    this.data.state.lastServerSequence = String(info.update_seq);
    this.data.state.lastFullScanAt = Date.now();
    if (report.errors.length === 0) {
      this.data.settings.initialised = true;
      this.data.settings.initialMode = "merge";
      this.localDirty = false;
    }
    report.finishedAt = Date.now();
    this.data.state.lastErrors = report.errors.slice(0, 500);
    await this.callbacks.save();
    return report;
  }
  async executeAction(action, client, localVault, context, report, remoteEntries, localEntries) {
    if (action.type === "equal") {
      const remote = remoteEntries.get(action.pathKey);
      const local = localEntries.get(action.pathKey);
      const state = this.data.state.files[action.pathKey];
      if (remote) {
        this.recordState(
          action.pathKey,
          remoteToken(remote),
          remote.path,
          remote.kind,
          local?.mtime ?? remote.mtime,
          local?.size ?? remote.size,
          remote.rev
        );
      } else if (state) {
        state.token = DELETED_TOKEN;
        state.localMtime = 0;
        state.localSize = 0;
      }
      report.unchanged += 1;
      return;
    }
    if (action.type === "upload") {
      const uploaded = await this.uploadEntry(client, localVault, context, action.local, action.remote);
      remoteEntries.set(action.pathKey, uploaded);
      this.recordState(
        action.pathKey,
        remoteToken(uploaded),
        action.local.path,
        action.local.kind,
        uploaded.mtime,
        uploaded.size,
        uploaded.rev
      );
      report.uploaded += 1;
      return;
    }
    if (action.type === "upload-delete") {
      const uploaded = await this.uploadDeletion(client, context, action.previous, action.remote);
      remoteEntries.set(action.pathKey, uploaded);
      this.recordState(action.pathKey, DELETED_TOKEN, uploaded.path, uploaded.kind, 0, 0, uploaded.rev);
      report.deletedRemote += 1;
      return;
    }
    if (action.type === "download") {
      await this.downloadEntry(client, localVault, context, action.remote);
      this.recordRemoteAsLocal(action.remote, await localVault.stat(action.remote.path));
      report.downloaded += 1;
      return;
    }
    if (action.type === "delete-local") {
      await localVault.remove(action.local.path);
      this.recordState(action.pathKey, DELETED_TOKEN, action.remote.path, action.remote.kind, 0, 0, action.remote.rev);
      report.deletedLocal += 1;
      return;
    }
    const target = conflictPath(action.local.path, this.data.settings.deviceName);
    await localVault.moveToConflict(action.local.path, target);
    if (!action.remote.deleted) {
      await this.downloadEntry(client, localVault, context, action.remote);
      this.recordRemoteAsLocal(action.remote, await localVault.stat(action.remote.path));
      report.downloaded += 1;
    } else {
      this.recordState(action.pathKey, DELETED_TOKEN, action.remote.path, action.remote.kind, 0, 0, action.remote.rev);
    }
    report.conflicts += 1;
    this.rerunRequested = true;
  }
  async uploadEntry(client, localVault, context, local, expectedRemote) {
    const payload = {
      schema: 1,
      path: local.path,
      pathKey: local.pathKey,
      kind: local.kind,
      deleted: false,
      size: local.size,
      mtime: local.mtime,
      deviceId: this.data.settings.deviceId,
      deviceName: this.data.settings.deviceName,
      updatedAt: Date.now()
    };
    if (local.kind === "file") {
      const beforeRead = await localVault.stat(local.path);
      const bytes = await localVault.read(local.path);
      const hash = await sha256(toArrayBuffer(bytes));
      const afterRead = await localVault.stat(local.path);
      const stableRead = beforeRead?.type === "file" && afterRead?.type === "file" && beforeRead.mtime === afterRead.mtime && beforeRead.size === afterRead.size;
      payload.size = bytes.byteLength;
      payload.mtime = stableRead ? afterRead.mtime : beforeRead?.mtime ?? local.mtime;
      const encrypted = await encryptBytes(context, bytes);
      const blobKey = await keyedId(context, "blob", `v2:${hash}:${encrypted.iv}`);
      const chunks = await client.uploadBlob(blobKey, encrypted.data, this.data.settings.chunkSizeKb * 1024);
      payload.contentHash = hash;
      payload.blobKey = blobKey;
      payload.chunks = chunks;
      payload.contentIv = encrypted.iv;
      payload.blobVersion = 2;
    }
    return client.putHead(context, payload, expectedRemote);
  }
  async uploadDeletion(client, context, previous, expectedRemote) {
    const payload = {
      schema: 1,
      path: previous.path,
      pathKey: pathKey(previous.path),
      kind: previous.kind,
      deleted: true,
      size: 0,
      mtime: Date.now(),
      deviceId: this.data.settings.deviceId,
      deviceName: this.data.settings.deviceName,
      updatedAt: Date.now()
    };
    return client.putHead(context, payload, expectedRemote);
  }
  async downloadEntry(client, localVault, context, remote) {
    if (remote.deleted) return;
    if (remote.kind === "folder") {
      await localVault.ensureFolder(remote.path);
      return;
    }
    if (!remote.blobKey || !remote.chunks || !remote.contentIv || !remote.contentHash) {
      throw new Error("\u0421\u0435\u0440\u0432\u0435\u0440\u043D\u043E\u0435 \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u0444\u0430\u0439\u043B\u0430 \u043D\u0435\u043F\u043E\u043B\u043D\u043E");
    }
    const encryptedData = await client.downloadBlob(remote.blobKey, remote.chunks);
    const bytes = await decryptBytes(context, { iv: remote.contentIv, data: encryptedData });
    const actualHash = await sha256(toArrayBuffer(bytes));
    if (actualHash !== remote.contentHash) throw new Error("\u041A\u043E\u043D\u0442\u0440\u043E\u043B\u044C\u043D\u0430\u044F \u0441\u0443\u043C\u043C\u0430 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430 \u043D\u0435 \u0441\u043E\u0432\u043F\u0430\u043B\u0430");
    await localVault.write(remote.path, bytes, remote.mtime);
  }
  recordRemoteAsLocal(remote, stat) {
    this.recordState(
      remote.pathKey,
      remoteToken(remote),
      remote.path,
      remote.kind,
      stat?.mtime ?? remote.mtime,
      stat?.size ?? remote.size,
      remote.rev
    );
  }
  recordState(key, token, path, kind, localMtime, localSize, remoteRev) {
    this.data.state.files[key] = { path, kind, token, localMtime, localSize, remoteRev };
  }
  createClient() {
    const settings = this.data.settings;
    return new CouchClient(settings.serverUrl, settings.database, settings.username, settings.password);
  }
  async cryptoContext() {
    const settings = this.data.settings;
    const signature = `${settings.encryptionSalt}\0${settings.encryptionPassphrase}`;
    if (this.cryptoCache?.signature === signature) return this.cryptoCache.context;
    const context = await createCryptoContext(settings.encryptionPassphrase, settings.encryptionSalt);
    this.cryptoCache = { signature, context };
    return context;
  }
  async prepareCrypto(client) {
    let config = await client.fetchVaultConfig();
    if (!config) {
      const context2 = await this.cryptoContext();
      if (await client.hasHeadDocuments()) {
        try {
          await client.fetchManifest(context2);
        } catch {
          throw new Error(
            "\u0421\u0442\u0430\u0440\u0430\u044F \u0431\u0430\u0437\u0430 \u043D\u0435 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u0440\u0435\u0437\u0435\u0440\u0432\u043D\u043E\u0439 \u0441\u043E\u043B\u0438, \u0430 \u0442\u0435\u043A\u0443\u0449\u0438\u043C\u0438 \u043F\u0430\u0440\u043E\u043B\u0435\u043C \u0438 \u0441\u043E\u043B\u044C\u044E \u0435\u0451 \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u0430\u0442\u044C \u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C"
          );
        }
      }
      config = await client.putVaultConfig({
        type: "config",
        schema: 1,
        encryptionSalt: this.data.settings.encryptionSalt,
        verifier: await encryptJson(context2, { marker: "vps-sync", schema: 1 }),
        createdAt: Date.now()
      });
    }
    if (config.encryptionSalt !== this.data.settings.encryptionSalt) {
      this.data.settings.encryptionSalt = config.encryptionSalt;
      this.cryptoCache = void 0;
      await this.callbacks.save();
    }
    const context = await this.cryptoContext();
    let verifier;
    try {
      verifier = await decryptJson(context, config.verifier);
    } catch {
      throw new Error("\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u0434\u043B\u044F \u044D\u0442\u043E\u0439 \u0431\u0430\u0437\u044B");
    }
    if (verifier.marker !== "vps-sync" || verifier.schema !== 1) {
      throw new Error("\u0421\u043B\u0443\u0436\u0435\u0431\u043D\u0430\u044F \u0437\u0430\u043F\u0438\u0441\u044C \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u043F\u043E\u0432\u0440\u0435\u0436\u0434\u0435\u043D\u0430");
    }
    return context;
  }
  validateSettings() {
    const settings = this.data.settings;
    if (!/^https:\/\//iu.test(settings.serverUrl)) throw new Error("\u0410\u0434\u0440\u0435\u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u0430 \u0434\u043E\u043B\u0436\u0435\u043D \u043D\u0430\u0447\u0438\u043D\u0430\u0442\u044C\u0441\u044F \u0441 https://");
    if (!settings.database.trim()) throw new Error("\u041D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u043E \u0438\u043C\u044F \u0431\u0430\u0437\u044B CouchDB");
    if (!settings.username.trim() || !settings.password) throw new Error("\u041D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u044B \u0438\u043C\u044F \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F \u0438\u043B\u0438 \u043F\u0430\u0440\u043E\u043B\u044C CouchDB");
    if (!settings.encryptionSalt) throw new Error("\u041D\u0435 \u0441\u043E\u0437\u0434\u0430\u043D\u0430 \u0441\u043E\u043B\u044C \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u044F");
    if (settings.encryptionPassphrase.length < 12) throw new Error("\u041F\u0430\u0440\u043E\u043B\u044C \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u0434\u043E\u043B\u0436\u0435\u043D \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u0442\u044C \u043D\u0435 \u043C\u0435\u043D\u0435\u0435 12 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432");
  }
  actionPath(action) {
    if ("local" in action && action.local) return action.local.path;
    if ("remote" in action && action.remote) return action.remote.path;
    if ("previous" in action) return action.previous.path;
    return action.pathKey;
  }
};

// src/panel-view.ts
var import_obsidian2 = require("obsidian");
var VPS_SYNC_VIEW_TYPE = "vps-sync-panel";
var LEVEL_LABELS = {
  info: "\u0421\u0432\u0435\u0434\u0435\u043D\u0438\u044F",
  success: "\u0423\u0441\u043F\u0435\u0445",
  warning: "\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435",
  error: "\u041E\u0448\u0438\u0431\u043A\u0430"
};
function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
var VpsSyncPanelView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  statusValueEl;
  getViewType() {
    return VPS_SYNC_VIEW_TYPE;
  }
  getDisplayText() {
    return "VPS Sync";
  }
  getIcon() {
    return "refresh-cw";
  }
  async onOpen() {
    this.contentEl.addClass("vps-sync-panel");
    this.refresh();
  }
  async onClose() {
    this.statusValueEl = void 0;
  }
  updateStatus(status) {
    if (!this.statusValueEl) return;
    this.statusValueEl.setText(status);
    this.statusValueEl.toggleClass("is-error", status === "\u043E\u0448\u0438\u0431\u043A\u0430");
    this.statusValueEl.toggleClass("is-paused", status === "\u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E");
    this.statusValueEl.toggleClass("is-ready", status === "\u0433\u043E\u0442\u043E\u0432\u043E");
  }
  refresh() {
    const container = this.contentEl;
    container.empty();
    const header = container.createDiv({ cls: "vps-sync-panel-header" });
    header.createEl("h2", { text: "VPS Sync" });
    header.createSpan({ text: `v${this.plugin.manifest.version}`, cls: "vps-sync-version" });
    const statusCard = container.createDiv({ cls: "vps-sync-status-card" });
    statusCard.createDiv({ text: "\u0421\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435", cls: "vps-sync-section-label" });
    this.statusValueEl = statusCard.createDiv({ cls: "vps-sync-current-status" });
    this.updateStatus(this.plugin.getCurrentStatus());
    const controls = container.createDiv({ cls: "vps-sync-controls" });
    this.addButton(controls, "\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u0442\u044C", () => this.plugin.syncNow(true), true);
    this.addButton(controls, "\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C", () => this.plugin.testConnection());
    this.addButton(
      controls,
      this.plugin.data.settings.paused ? "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C" : "\u041F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C",
      () => this.plugin.togglePaused()
    );
    this.renderLastReport(container, this.plugin.data.state.lastReport);
    this.renderErrors(container);
    this.renderActivity(container);
  }
  renderLastReport(container, report) {
    if (!report) return;
    const section = container.createDiv({ cls: "vps-sync-panel-section" });
    const heading = section.createDiv({ cls: "vps-sync-section-heading" });
    heading.createEl("h3", { text: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F" });
    heading.createSpan({ text: formatTime(report.finishedAt), cls: "vps-sync-muted" });
    const metrics = section.createDiv({ cls: "vps-sync-metrics" });
    this.addMetric(metrics, "\u041E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E", report.uploaded);
    this.addMetric(metrics, "\u041F\u043E\u043B\u0443\u0447\u0435\u043D\u043E", report.downloaded);
    this.addMetric(metrics, "\u0423\u0434\u0430\u043B\u0435\u043D\u043E \u0437\u0434\u0435\u0441\u044C", report.deletedLocal);
    this.addMetric(metrics, "\u0423\u0434\u0430\u043B\u0435\u043D\u043E \u043D\u0430 VPS", report.deletedRemote);
    this.addMetric(metrics, "\u041A\u043E\u043D\u0444\u043B\u0438\u043A\u0442\u044B", report.conflicts, report.conflicts > 0 ? "warning" : void 0);
    this.addMetric(metrics, "\u041E\u0448\u0438\u0431\u043A\u0438", report.errors.length, report.errors.length > 0 ? "error" : void 0);
  }
  renderErrors(container) {
    const errors = this.plugin.data.state.lastErrors;
    const section = container.createDiv({ cls: "vps-sync-panel-section" });
    const heading = section.createDiv({ cls: "vps-sync-section-heading" });
    heading.createEl("h3", { text: `\u041E\u0448\u0438\u0431\u043A\u0438 (${errors.length})` });
    const copyButton = heading.createEl("button", { text: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C" });
    copyButton.disabled = errors.length === 0;
    copyButton.addEventListener("click", () => void this.runButtonAction(copyButton, () => this.plugin.copyErrors()));
    if (errors.length === 0) {
      section.createDiv({ text: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043B\u0430\u0441\u044C \u0431\u0435\u0437 \u043E\u0448\u0438\u0431\u043E\u043A.", cls: "vps-sync-empty" });
      return;
    }
    const list = section.createDiv({ cls: "vps-sync-error-list" });
    for (const error of errors.slice(0, 20)) {
      list.createDiv({ text: error, cls: "vps-sync-error-item" });
    }
    if (errors.length > 20) {
      section.createDiv({ text: `\u0415\u0449\u0451 ${errors.length - 20}. \u041F\u043E\u043B\u043D\u044B\u0439 \u043F\u0435\u0440\u0435\u0447\u0435\u043D\u044C \u043A\u043E\u043F\u0438\u0440\u0443\u0435\u0442\u0441\u044F \u043A\u043D\u043E\u043F\u043A\u043E\u0439 \u0432\u044B\u0448\u0435.`, cls: "vps-sync-muted" });
    }
  }
  renderActivity(container) {
    const entries = this.plugin.data.state.activityLog;
    const section = container.createDiv({ cls: "vps-sync-panel-section" });
    const heading = section.createDiv({ cls: "vps-sync-section-heading" });
    heading.createEl("h3", { text: "\u0416\u0443\u0440\u043D\u0430\u043B" });
    const actions = heading.createDiv({ cls: "vps-sync-heading-actions" });
    const copyButton = actions.createEl("button", { text: "\u041A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C" });
    copyButton.disabled = entries.length === 0;
    copyButton.addEventListener("click", () => void this.runButtonAction(copyButton, () => this.plugin.copyActivityLog()));
    const clearButton = actions.createEl("button", { text: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C" });
    clearButton.disabled = entries.length === 0;
    clearButton.addEventListener("click", () => void this.runButtonAction(clearButton, () => this.plugin.clearActivityLog()));
    if (entries.length === 0) {
      section.createDiv({ text: "\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442.", cls: "vps-sync-empty" });
      return;
    }
    const list = section.createDiv({ cls: "vps-sync-activity-list" });
    for (const entry of [...entries].reverse()) {
      const item = list.createDiv({ cls: `vps-sync-activity-item is-${entry.level}` });
      const meta = item.createDiv({ cls: "vps-sync-activity-meta" });
      meta.createSpan({ text: LEVEL_LABELS[entry.level] });
      const repeats = entry.count > 1 ? ` \xB7 \xD7${entry.count}` : "";
      meta.createSpan({ text: `${formatTime(entry.timestamp)}${repeats}` });
      item.createDiv({ text: entry.message, cls: "vps-sync-activity-message" });
    }
  }
  addMetric(container, label, value, level) {
    const metric = container.createDiv({ cls: `vps-sync-metric${level ? ` is-${level}` : ""}` });
    metric.createDiv({ text: String(value), cls: "vps-sync-metric-value" });
    metric.createDiv({ text: label, cls: "vps-sync-metric-label" });
  }
  addButton(container, label, action, primary = false) {
    const button = container.createEl("button", {
      text: label,
      cls: primary ? "mod-cta" : void 0
    });
    button.addEventListener("click", () => void this.runButtonAction(button, action));
  }
  async runButtonAction(button, action) {
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.plugin.recordActivity("error", message);
    } finally {
      this.refresh();
    }
  }
};

// src/settings-tab.ts
var import_obsidian3 = require("obsidian");

// src/setup-code.ts
function exportSetupCode(settings) {
  const value = {
    schema: 1,
    serverUrl: settings.serverUrl,
    database: settings.database,
    username: settings.username,
    password: settings.password,
    encryptionPassphrase: settings.encryptionPassphrase,
    encryptionSalt: settings.encryptionSalt,
    chunkSizeKb: settings.chunkSizeKb,
    maxFileSizeMb: settings.maxFileSizeMb
  };
  return `VPSSYNC1:${bytesToBase64(utf8(JSON.stringify(value)))}`;
}
function importSetupCode(code, current) {
  const trimmed = code.trim();
  if (!trimmed.startsWith("VPSSYNC1:")) throw new Error("\u042D\u0442\u043E \u043D\u0435 \u043A\u043E\u0434 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F VPS Sync");
  const json = decodeUtf8(toArrayBuffer(base64ToBytes(trimmed.slice("VPSSYNC1:".length))));
  const value = JSON.parse(json);
  if (value.schema !== 1) throw new Error("\u0412\u0435\u0440\u0441\u0438\u044F \u043A\u043E\u0434\u0430 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F \u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F");
  if (!value.serverUrl || !value.database || !value.username || !value.password || !value.encryptionPassphrase || !value.encryptionSalt) {
    throw new Error("\u041A\u043E\u0434 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F \u043D\u0435\u043F\u043E\u043B\u043E\u043D");
  }
  return {
    ...current,
    serverUrl: value.serverUrl,
    database: value.database,
    username: value.username,
    password: value.password,
    encryptionPassphrase: value.encryptionPassphrase,
    encryptionSalt: value.encryptionSalt,
    chunkSizeKb: value.chunkSizeKb ?? current.chunkSizeKb,
    maxFileSizeMb: value.maxFileSizeMb ?? current.maxFileSizeMb
  };
}

// src/settings-tab.ts
var VpsSyncSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  setupCode = "";
  display() {
    const { containerEl } = this;
    const settings = this.plugin.data.settings;
    containerEl.empty();
    containerEl.createEl("h2", { text: "VPS Sync" });
    containerEl.createEl("p", {
      text: "\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0438\u0440\u0443\u0435\u0442 \u0437\u0430\u043C\u0435\u0442\u043A\u0438, \u0432\u043B\u043E\u0436\u0435\u043D\u0438\u044F, \u043F\u0430\u043F\u043A\u0438, \u0442\u0435\u043C\u044B, CSS, \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F \u0438 \u0438\u0445 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438. \u0412\u0441\u0435 \u0437\u0430\u043F\u0440\u043E\u0441\u044B \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u044E\u0442\u0441\u044F \u0441\u0442\u0440\u043E\u0433\u043E \u043F\u043E\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u043D\u043E."
    });
    new import_obsidian3.Setting(containerEl).setName("\u0410\u0434\u0440\u0435\u0441 CouchDB").setDesc("\u041A\u043E\u0440\u043D\u0435\u0432\u043E\u0439 \u0430\u0434\u0440\u0435\u0441 \u0431\u0435\u0437 \u0438\u043C\u0435\u043D\u0438 \u0431\u0430\u0437\u044B. \u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: https://sync.example.org").addText(
      (text) => text.setPlaceholder("https://example.org").setValue(settings.serverUrl).onChange(async (value) => {
        settings.serverUrl = value.trim();
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u0411\u0430\u0437\u0430 \u0434\u0430\u043D\u043D\u044B\u0445").setDesc("\u0414\u043B\u044F VPS Sync \u043D\u0443\u0436\u043D\u0430 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u0430\u044F \u0431\u0430\u0437\u0430, \u043D\u0435 \u0431\u0430\u0437\u0430 Self-hosted LiveSync.").addText(
      (text) => text.setValue(settings.database).onChange(async (value) => {
        settings.database = value.trim();
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C CouchDB").addText(
      (text) => text.setValue(settings.username).onChange(async (value) => {
        settings.username = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u041F\u0430\u0440\u043E\u043B\u044C CouchDB").addText((text) => {
      text.inputEl.type = "password";
      text.setValue(settings.password).onChange(async (value) => {
        settings.password = value;
        await this.plugin.savePluginData();
      });
    });
    new import_obsidian3.Setting(containerEl).setName("\u041F\u0430\u0440\u043E\u043B\u044C \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u044F").setDesc("\u041D\u0435 \u043C\u0435\u043D\u0435\u0435 12 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432. \u0414\u043E\u043B\u0436\u0435\u043D \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u0442\u044C \u043D\u0430 \u0432\u0441\u0435\u0445 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430\u0445.").addText((text) => {
      text.inputEl.type = "password";
      text.setValue(settings.encryptionPassphrase).onChange(async (value) => {
        settings.encryptionPassphrase = value;
        await this.plugin.savePluginData();
      });
    });
    new import_obsidian3.Setting(containerEl).setName("\u0421\u043E\u043B\u044C \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u044F").setDesc("\u0421\u043E\u0437\u0434\u0430\u0451\u0442\u0441\u044F \u043E\u0434\u0438\u043D \u0440\u0430\u0437 \u0438 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u0442\u0441\u044F \u043A\u043E\u0434\u043E\u043C \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F.").addText((text) => text.setValue(settings.encryptionSalt).setDisabled(true)).addButton(
      (button) => button.setButtonText("\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u043D\u043E\u0432\u0443\u044E").onClick(async () => {
        if (settings.initialised) {
          this.plugin.recordActivity("warning", "\u041D\u0435\u043B\u044C\u0437\u044F \u043C\u0435\u043D\u044F\u0442\u044C \u0441\u043E\u043B\u044C \u043F\u043E\u0441\u043B\u0435 \u043D\u0430\u0447\u0430\u043B\u0430 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0438: \u0441\u0442\u0430\u0440\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u0441\u0442\u0430\u043D\u0443\u0442 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B");
          await this.plugin.openPanel();
          return;
        }
        settings.encryptionSalt = createSalt();
        await this.plugin.savePluginData();
        this.display();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430").addText(
      (text) => text.setValue(settings.deviceName).onChange(async (value) => {
        settings.deviceName = value.trim() || "\u0423\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E";
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u041F\u0435\u0440\u0438\u043E\u0434 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0438").setDesc("\u0421\u0435\u043A\u0443\u043D\u0434\u044B. \u0420\u0430\u0431\u043E\u0442\u0430\u0435\u0442, \u043F\u043E\u043A\u0430 Obsidian \u043E\u0442\u043A\u0440\u044B\u0442; iOS \u043D\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0430\u0435\u0442 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044E \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u043F\u043E\u0441\u043B\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F.").addText(
      (text) => text.setValue(String(settings.syncIntervalSeconds)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) settings.syncIntervalSeconds = Math.max(10, parsed);
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u041F\u0440\u0435\u0434\u0435\u043B\u044C\u043D\u044B\u0439 \u0440\u0430\u0437\u043C\u0435\u0440 \u0444\u0430\u0439\u043B\u0430").setDesc("\u041C\u0435\u0433\u0430\u0431\u0430\u0439\u0442\u044B. \u0411\u043E\u043B\u0435\u0435 \u043A\u0440\u0443\u043F\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u044E\u0442\u0441\u044F \u0438 \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u0432 \u0436\u0443\u0440\u043D\u0430\u043B\u0435.").addText(
      (text) => text.setValue(String(settings.maxFileSizeMb)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) settings.maxFileSizeMb = Math.max(1, parsed);
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0438\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F").setDesc("\u041E\u0434\u0438\u043D \u043F\u0443\u0442\u044C \u0438\u043B\u0438 \u0448\u0430\u0431\u043B\u043E\u043D \u043D\u0430 \u0441\u0442\u0440\u043E\u043A\u0443. \u041F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u044E\u0442\u0441\u044F * \u0438 **.").addTextArea(
      (text) => text.setValue(settings.extraExcludedPatterns.join("\n")).onChange(async (value) => {
        settings.extraExcludedPatterns = value.split("\n").map((item) => item.trim()).filter(Boolean);
        await this.plugin.savePluginData();
      })
    );
    containerEl.createEl("h3", { text: "\u041F\u0435\u0440\u0435\u043D\u043E\u0441 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F \u043D\u0430 iPhone" });
    new import_obsidian3.Setting(containerEl).setName("\u041A\u043E\u0434 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F").setDesc("\u0421\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u043F\u0430\u0440\u043E\u043B\u0438. \u041D\u0435 \u043F\u0443\u0431\u043B\u0438\u043A\u0443\u0439\u0442\u0435 \u0438 \u043D\u0435 \u0445\u0440\u0430\u043D\u0438\u0442\u0435 \u0435\u0433\u043E \u0432 \u0437\u0430\u043C\u0435\u0442\u043A\u0430\u0445.").addTextArea(
      (text) => text.setPlaceholder("\u0412\u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u043A\u043E\u0434 \u043D\u0430 \u0432\u0442\u043E\u0440\u043E\u043C \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0435").onChange((value) => {
        this.setupCode = value;
      })
    ).addButton(
      (button) => button.setButtonText("\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C").onClick(async () => {
        try {
          await navigator.clipboard.writeText(exportSetupCode(settings));
          button.setButtonText("\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E");
          this.plugin.recordActivity("success", "\u041A\u043E\u0434 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D");
          window.setTimeout(() => button.setButtonText("\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C"), 1500);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.plugin.recordActivity("error", `\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043A\u043E\u0434 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F: ${message}`);
          await this.plugin.openPanel();
        }
      })
    ).addButton(
      (button) => button.setButtonText("\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C").setCta().onClick(async () => {
        try {
          this.plugin.data.settings = importSetupCode(this.setupCode, settings);
          await this.plugin.savePluginData();
          this.plugin.recordActivity("success", "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0438\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u043E. \u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0438 \u0438\u0434\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0442\u043E\u0440 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B");
          this.display();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.plugin.recordActivity("error", `\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0438\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435: ${message}`);
          await this.plugin.openPanel();
        }
      })
    );
    containerEl.createEl("h3", { text: "\u0417\u0430\u043F\u0443\u0441\u043A" });
    new import_obsidian3.Setting(containerEl).setName("\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435").setDesc("\u0421\u043E\u0437\u0434\u0430\u0451\u0442 \u0431\u0430\u0437\u0443, \u0435\u0441\u043B\u0438 \u0435\u0451 \u0435\u0449\u0451 \u043D\u0435\u0442, \u043D\u043E \u043D\u0435 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u0442 \u0444\u0430\u0439\u043B\u044B.").addButton(
      (button) => button.setButtonText("\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C").onClick(async () => {
        await this.plugin.testConnection();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u042D\u0442\u043E \u043E\u0441\u043D\u043E\u0432\u043D\u043E\u0435 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E").setDesc("\u041F\u0435\u0440\u0432\u044B\u0439 \u0437\u0430\u043F\u0443\u0441\u043A \u043D\u0430 \u043A\u043E\u043C\u043F\u044C\u044E\u0442\u0435\u0440\u0435: \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u0438\u043C\u0435\u044E\u0442 \u043F\u0440\u0435\u0438\u043C\u0443\u0449\u0435\u0441\u0442\u0432\u043E \u043F\u0440\u0438 \u0441\u043E\u0432\u043F\u0430\u0434\u0435\u043D\u0438\u0438 \u043F\u0443\u0442\u0435\u0439.").addButton(
      (button) => button.setButtonText("\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435").setCta().onClick(async () => {
        await this.plugin.startInitialSync("prefer-local");
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u042D\u0442\u043E \u043D\u043E\u0432\u043E\u0435 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E").setDesc("\u041F\u0435\u0440\u0432\u044B\u0439 \u0437\u0430\u043F\u0443\u0441\u043A \u043D\u0430 iPhone: \u0441\u0435\u0440\u0432\u0435\u0440\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u0438\u043C\u0435\u044E\u0442 \u043F\u0440\u0435\u0438\u043C\u0443\u0449\u0435\u0441\u0442\u0432\u043E \u043F\u0440\u0438 \u0441\u043E\u0432\u043F\u0430\u0434\u0435\u043D\u0438\u0438 \u043F\u0443\u0442\u0435\u0439.").addButton(
      (button) => button.setButtonText("\u041F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435").setCta().onClick(async () => {
        await this.plugin.startInitialSync("prefer-remote");
      })
    );
    new import_obsidian3.Setting(containerEl).setName(settings.paused ? "\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0430" : "\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u0430").addButton(
      (button) => button.setButtonText(settings.paused ? "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C" : "\u041F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C").onClick(async () => {
        await this.plugin.togglePaused();
        this.display();
      })
    );
    const lastErrors = this.plugin.data.state.lastErrors ?? [];
    const activityLog = this.plugin.data.state.activityLog ?? [];
    containerEl.createEl("h3", { text: "\u0414\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u043A\u0430" });
    containerEl.createEl("p", {
      text: "\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F VPS Sync \u043D\u0430\u0445\u043E\u0434\u044F\u0442\u0441\u044F \u0432 \u0431\u043E\u043A\u043E\u0432\u043E\u0439 \u043F\u0430\u043D\u0435\u043B\u0438. \u041E\u0442\u0447\u0451\u0442 \u043D\u0435 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u043F\u0430\u0440\u043E\u043B\u0438, \u0441\u043E\u043B\u044C \u0438\u043B\u0438 \u043A\u043E\u0434 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F."
    });
    new import_obsidian3.Setting(containerEl).setName("\u0411\u043E\u043A\u043E\u0432\u0430\u044F \u043F\u0430\u043D\u0435\u043B\u044C").setDesc("\u0422\u0435\u043A\u0443\u0449\u0435\u0435 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435, \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u044B \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0438, \u043E\u0448\u0438\u0431\u043A\u0438 \u0438 \u0436\u0443\u0440\u043D\u0430\u043B \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439.").addButton(
      (button) => button.setButtonText("\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0430\u043D\u0435\u043B\u044C").setCta().onClick(async () => {
        await this.plugin.openPanel();
      })
    );
    new import_obsidian3.Setting(containerEl).setName(`\u041E\u0448\u0438\u0431\u043A\u0438 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0439 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0438: ${lastErrors.length}`).setDesc(lastErrors.length > 0 ? "\u041A\u043E\u043F\u0438\u0440\u0443\u0435\u0442 \u0442\u043E\u0447\u043D\u044B\u0435 \u043F\u0443\u0442\u0438 \u0438 \u043F\u0440\u0438\u0447\u0438\u043D\u044B \u043E\u0448\u0438\u0431\u043E\u043A \u0434\u043B\u044F \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A\u0443." : "\u041E\u0448\u0438\u0431\u043E\u043A \u043D\u0435\u0442.").addButton((button) => {
      button.setButtonText("\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043E\u0448\u0438\u0431\u043A\u0438").setDisabled(lastErrors.length === 0).onClick(async () => {
        try {
          await this.plugin.copyErrors();
          button.setButtonText("\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E");
          window.setTimeout(() => button.setButtonText("\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043E\u0448\u0438\u0431\u043A\u0438"), 1500);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.plugin.recordActivity("error", `\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043E\u0448\u0438\u0431\u043A\u0438: ${message}`);
          await this.plugin.openPanel();
        }
      });
    });
    new import_obsidian3.Setting(containerEl).setName(`\u0416\u0443\u0440\u043D\u0430\u043B \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439: ${activityLog.length}`).setDesc("\u041A\u043E\u043F\u0438\u0440\u0443\u0435\u0442 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u044B \u043F\u0440\u043E\u0432\u0435\u0440\u043E\u043A, \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0439 \u0438 \u0441\u043B\u0443\u0436\u0435\u0431\u043D\u044B\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F VPS Sync.").addButton((button) => {
      button.setButtonText("\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0436\u0443\u0440\u043D\u0430\u043B").setDisabled(activityLog.length === 0).onClick(async () => {
        try {
          await this.plugin.copyActivityLog();
          button.setButtonText("\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E");
          window.setTimeout(() => button.setButtonText("\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0436\u0443\u0440\u043D\u0430\u043B"), 1500);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.plugin.recordActivity("error", `\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0436\u0443\u0440\u043D\u0430\u043B: ${message}`);
          await this.plugin.openPanel();
        }
      });
    });
    if (lastErrors.length > 0) {
      containerEl.createEl("h4", { text: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u043E\u0448\u0438\u0431\u043A\u0438" });
      containerEl.createEl("p", {
        text: "\u0423\u043A\u0430\u0437\u0430\u043D\u044B \u0442\u043E\u0447\u043D\u044B\u0435 \u043F\u0443\u0442\u0438 \u0438 \u043F\u0440\u0438\u0447\u0438\u043D\u044B \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0439 \u043D\u0435\u0443\u0434\u0430\u0447\u043D\u043E\u0439 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0438."
      });
      new import_obsidian3.Setting(containerEl).setName("\u0416\u0443\u0440\u043D\u0430\u043B \u043E\u0448\u0438\u0431\u043E\u043A").addTextArea((text) => {
        text.setValue(lastErrors.join("\n"));
        text.inputEl.readOnly = true;
        text.inputEl.rows = Math.min(14, Math.max(4, lastErrors.length));
      });
    }
  }
};

// src/main.ts
var VpsSyncPlugin = class extends import_obsidian4.Plugin {
  data;
  engine;
  currentStatus = "\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430";
  lastAutomaticRun = 0;
  changeTimer;
  saveQueue = Promise.resolve();
  async onload() {
    await this.loadPluginData();
    this.setStatus(this.data.settings.paused ? "\u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E" : "\u0433\u043E\u0442\u043E\u0432\u043E");
    this.registerView(VPS_SYNC_VIEW_TYPE, (leaf) => new VpsSyncPanelView(leaf, this));
    this.addRibbonIcon("refresh-cw", "\u041E\u0442\u043A\u0440\u044B\u0442\u044C VPS Sync", () => void this.openPanel());
    this.engine = new SyncEngine(this.app, this.data, {
      save: () => this.savePluginData(),
      status: (message) => this.setStatus(message),
      log: (message, error) => console.error(`[VPS Sync] ${message}`, error ?? "")
    });
    this.addSettingTab(new VpsSyncSettingTab(this.app, this));
    this.addCommand({
      id: "open-panel",
      name: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0431\u043E\u043A\u043E\u0432\u0443\u044E \u043F\u0430\u043D\u0435\u043B\u044C",
      callback: () => void this.openPanel()
    });
    this.addCommand({
      id: "sync-now",
      name: "\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u0435\u0439\u0447\u0430\u0441",
      callback: () => void this.openPanel().then(() => this.syncNow(true))
    });
    this.addCommand({
      id: "pause-or-resume",
      name: "\u041F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0438\u043B\u0438 \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044E",
      callback: () => void this.openPanel().then(() => this.togglePaused())
    });
    this.addCommand({
      id: "test-connection",
      name: "\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043A VPS",
      callback: () => void this.openPanel().then(() => this.testConnection())
    });
    this.registerEvent(this.app.vault.on("create", (file) => this.queueChangedVault(file.path)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.queueChangedVault(file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.queueChangedVault(file.path)));
    this.registerEvent(this.app.vault.on("rename", (file) => this.queueChangedVault(file.path)));
    this.registerInterval(
      window.setInterval(() => {
        const settings = this.data.settings;
        if (settings.paused || !settings.initialised || this.engine.isRunning()) return;
        if (Date.now() - this.lastAutomaticRun >= settings.syncIntervalSeconds * 1e3) {
          void this.syncNow(false);
        }
      }, 5e3)
    );
    if (this.data.settings.syncOnStart && this.data.settings.initialised && !this.data.settings.paused) {
      this.app.workspace.onLayoutReady(() => window.setTimeout(() => void this.syncNow(false), 1e3));
    }
  }
  onunload() {
    if (this.changeTimer !== void 0) window.clearTimeout(this.changeTimer);
    this.app.workspace.detachLeavesOfType(VPS_SYNC_VIEW_TYPE);
  }
  async savePluginData() {
    this.saveQueue = this.saveQueue.catch(() => void 0).then(() => this.saveData(this.data));
    await this.saveQueue;
  }
  async testConnection() {
    try {
      this.setStatus("\u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F");
      const message = await this.engine.testConnection();
      this.recordActivity("success", message);
      this.setStatus("\u0433\u043E\u0442\u043E\u0432\u043E");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordActivity("error", `\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F: ${message}`);
      this.setStatus("\u043E\u0448\u0438\u0431\u043A\u0430");
    }
  }
  async startInitialSync(mode) {
    this.data.settings.initialMode = mode;
    this.data.settings.initialised = false;
    this.data.settings.paused = false;
    await this.savePluginData();
    await this.syncNow(true);
  }
  async togglePaused() {
    this.data.settings.paused = !this.data.settings.paused;
    await this.savePluginData();
    this.setStatus(this.data.settings.paused ? "\u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E" : "\u0433\u043E\u0442\u043E\u0432\u043E");
    this.recordActivity("info", this.data.settings.paused ? "\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0430" : "\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u0430");
    if (!this.data.settings.paused && this.data.settings.initialised) await this.syncNow(false);
  }
  queueChangedVault(path) {
    if (this.data.settings.paused || !this.data.settings.initialised) return;
    const normalisedPath = path.replaceAll("\\", "/").replace(/\/$/u, "");
    const ownDirectory = this.manifest.dir?.replaceAll("\\", "/").replace(/\/$/u, "");
    if (ownDirectory && (normalisedPath === ownDirectory || normalisedPath.startsWith(`${ownDirectory}/`))) return;
    if (/^\.obsidian\/plugins\/vps-sync(?:[-_.][^/]*)?(?:\/|$)/iu.test(normalisedPath)) return;
    this.engine.markLocalDirty();
    if (this.changeTimer !== void 0) window.clearTimeout(this.changeTimer);
    this.changeTimer = window.setTimeout(() => {
      this.changeTimer = void 0;
      void this.syncNow(false);
    }, 2e3);
  }
  async syncNow(showResult) {
    this.lastAutomaticRun = Date.now();
    try {
      const report = await this.engine.sync();
      const queued = report.errors.length === 1 && report.errors[0].startsWith("\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u0443\u0436\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F");
      if (queued) {
        this.recordActivity("warning", report.errors[0]);
        return;
      }
      this.data.state.lastReport = report;
      await this.savePluginData();
      if (showResult || report.errors.length > 0 || report.conflicts > 0) {
        const level = report.errors.length > 0 ? "error" : report.conflicts > 0 ? "warning" : "success";
        this.recordActivity(level, describeReport(report));
      } else {
        this.refreshPanels();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[VPS Sync] \u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u043F\u0440\u0435\u0440\u0432\u0430\u043D\u0430", error);
      this.data.state.lastErrors = [message];
      this.recordActivity("error", `\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u043F\u0440\u0435\u0440\u0432\u0430\u043D\u0430: ${message}`);
      this.setStatus("\u043E\u0448\u0438\u0431\u043A\u0430");
    }
  }
  getCurrentStatus() {
    return this.currentStatus;
  }
  setStatus(message) {
    this.currentStatus = message;
    for (const leaf of this.app.workspace.getLeavesOfType(VPS_SYNC_VIEW_TYPE)) {
      if (leaf.view instanceof VpsSyncPanelView) leaf.view.updateStatus(message);
    }
  }
  recordActivity(level, message) {
    this.data.state.activityLog = appendActivity(this.data.state.activityLog, level, message);
    this.refreshPanels();
    void this.savePluginData().catch((error) => console.error("[VPS Sync] \u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0436\u0443\u0440\u043D\u0430\u043B", error));
  }
  async copyErrors() {
    const text = formatErrorReport(
      this.manifest.version,
      this.data.settings.deviceName,
      this.data.state.lastErrors,
      this.data.state.lastReport
    );
    await navigator.clipboard.writeText(text);
    this.recordActivity("success", "\u041E\u0442\u0447\u0451\u0442 \u043E\u0431 \u043E\u0448\u0438\u0431\u043A\u0430\u0445 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D");
  }
  async copyActivityLog() {
    const text = formatActivityLog(this.data.state.activityLog);
    await navigator.clipboard.writeText(text);
    this.recordActivity("success", "\u0416\u0443\u0440\u043D\u0430\u043B \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D");
  }
  async clearActivityLog() {
    this.data.state.activityLog = [];
    await this.savePluginData();
    this.refreshPanels();
  }
  async openPanel() {
    const existing = this.app.workspace.getLeavesOfType(VPS_SYNC_VIEW_TYPE)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      if (existing.view instanceof VpsSyncPanelView) existing.view.refresh();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VPS_SYNC_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  refreshPanels() {
    for (const leaf of this.app.workspace.getLeavesOfType(VPS_SYNC_VIEW_TYPE)) {
      if (leaf.view instanceof VpsSyncPanelView) leaf.view.refresh();
    }
  }
  async loadPluginData() {
    const defaults = createDefaultData();
    const saved = await this.loadData();
    this.data = {
      settings: { ...defaults.settings, ...saved?.settings ?? {} },
      state: {
        ...defaults.state,
        ...saved?.state ?? {},
        files: { ...defaults.state.files, ...saved?.state?.files ?? {} },
        lastErrors: [...saved?.state?.lastErrors ?? []],
        activityLog: [...saved?.state?.activityLog ?? []].slice(-200)
      }
    };
    if (!saved?.settings?.deviceName || saved.settings.deviceName === "\u0423\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E") {
      this.data.settings.deviceName = import_obsidian4.Platform.isMobileApp ? "iPhone" : "\u041A\u043E\u043C\u043F\u044C\u044E\u0442\u0435\u0440";
    }
    await this.savePluginData();
  }
};
