/* Монитор памяти для Obsidian — локальная сборка */
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
  default: () => MemoryMonitorPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/monitor.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_inspector = require("node:inspector");
var import_node_os = require("node:os");
var import_node_process = require("node:process");
var UNKNOWN_ID = "__obsidian_unknown__";
var MemoryMonitorService = class {
  constructor(app, settings) {
    this.samples = [];
    this.allocations = [];
    this.subscribers = /* @__PURE__ */ new Set();
    this.sampleTimer = null;
    this.profileTimer = null;
    this.gpuTimer = null;
    this.session = null;
    this.profilerStatus = "\u0437\u0430\u043F\u0443\u0441\u043A";
    this.profilerMessage = "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0430\u044E \u0432\u044B\u0431\u043E\u0440\u043E\u0447\u043D\u043E\u0435 \u043D\u0430\u0431\u043B\u044E\u0434\u0435\u043D\u0438\u0435 V8\u2026";
    this.profilerStartedAt = 0;
    this.lastProfileAt = 0;
    this.totalSampledBytes = 0;
    this.recognizedBytes = 0;
    this.profileBusy = false;
    this.gpuBusy = false;
    this.gpuStatus = "\u043F\u043E\u0438\u0441\u043A";
    this.gpuMessage = "\u0418\u0449\u0443 \u0441\u0440\u0435\u0434\u0441\u0442\u0432\u0430 \u043D\u0430\u0431\u043B\u044E\u0434\u0435\u043D\u0438\u044F NVIDIA\u2026";
    this.gpuReading = null;
    this.gpuRetryAt = 0;
    this.previousProcessCpu = null;
    this.previousSystemCpu = null;
    this.previousDisk = null;
    this.previousResourceAt = 0;
    this.diskStatus = import_node_process.platform === "linux" ? "\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442" : "\u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D";
    this.paused = false;
    this.app = app;
    this.settings = settings;
  }
  start() {
    this.restartTimers();
    this.captureMemory();
    void this.pollGpu();
    void this.startProfiler();
  }
  stop() {
    this.clearTimers();
    void this.stopProfiler();
    this.subscribers.clear();
  }
  configure(settings) {
    this.settings = settings;
    this.trimHistory();
    if (!this.paused) this.restartTimers();
    this.emit();
  }
  subscribe(subscriber) {
    this.subscribers.add(subscriber);
    subscriber(this.snapshot());
    return () => this.subscribers.delete(subscriber);
  }
  snapshot() {
    return {
      samples: this.samples.slice(),
      allocations: this.allocations.slice(),
      totalSampledBytes: this.totalSampledBytes,
      recognizedBytes: this.recognizedBytes,
      profilerStatus: this.profilerStatus,
      profilerMessage: this.profilerMessage,
      profilerStartedAt: this.profilerStartedAt,
      lastProfileAt: this.lastProfileAt,
      gpuStatus: this.gpuStatus,
      gpuMessage: this.gpuMessage,
      diskStatus: this.diskStatus,
      paused: this.paused
    };
  }
  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.clearTimers();
      this.profilerStatus = "\u043F\u0430\u0443\u0437\u0430";
      this.profilerMessage = "\u0418\u0437\u043C\u0435\u0440\u0435\u043D\u0438\u0435 \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E";
      void this.stopProfiler();
    } else {
      this.profilerStatus = "\u0437\u0430\u043F\u0443\u0441\u043A";
      this.profilerMessage = "\u0412\u043E\u0437\u043E\u0431\u043D\u043E\u0432\u043B\u044F\u044E \u0438\u0437\u043C\u0435\u0440\u0435\u043D\u0438\u0435\u2026";
      this.restartTimers();
      this.captureMemory();
      void this.pollGpu();
      void this.startProfiler();
    }
    this.emit();
  }
  reset() {
    this.samples = [];
    this.allocations = [];
    this.totalSampledBytes = 0;
    this.recognizedBytes = 0;
    this.lastProfileAt = 0;
    this.previousProcessCpu = null;
    this.previousSystemCpu = null;
    this.previousDisk = null;
    this.previousResourceAt = 0;
    this.captureMemory();
    if (!this.paused) void this.restartProfiler();
    this.emit();
  }
  restartTimers() {
    this.clearTimers();
    this.sampleTimer = window.setInterval(
      () => this.captureMemory(),
      this.settings.sampleIntervalMs
    );
    this.profileTimer = window.setInterval(
      () => void this.captureProfile(),
      this.settings.profileIntervalMs
    );
    this.gpuTimer = window.setInterval(() => void this.pollGpu(), 2e3);
  }
  clearTimers() {
    if (this.sampleTimer !== null) window.clearInterval(this.sampleTimer);
    if (this.profileTimer !== null) window.clearInterval(this.profileTimer);
    if (this.gpuTimer !== null) window.clearInterval(this.gpuTimer);
    this.sampleTimer = null;
    this.profileTimer = null;
    this.gpuTimer = null;
  }
  captureMemory() {
    if (this.paused) return;
    try {
      const now = Date.now();
      const usage = (0, import_node_process.memoryUsage)();
      const resources = this.captureResourceDeltas(now);
      this.samples.push({
        at: now,
        rss: usage.rss,
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external,
        cpuProcessPercent: resources.cpuProcessPercent,
        cpuSystemPercent: resources.cpuSystemPercent,
        gpuUtilPercent: this.gpuReading?.utilization ?? null,
        gpuMemoryUsed: this.gpuReading?.memoryUsed ?? null,
        gpuMemoryTotal: this.gpuReading?.memoryTotal ?? null,
        gpuTemperature: this.gpuReading?.temperature ?? null,
        diskReadBytesPerSecond: resources.diskReadBytesPerSecond,
        diskWriteBytesPerSecond: resources.diskWriteBytesPerSecond
      });
      this.trimHistory();
      this.emit();
    } catch (error) {
      this.profilerMessage = `\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u043F\u0430\u043C\u044F\u0442\u044C \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u0430: ${errorMessage(error)}`;
      this.emit();
    }
  }
  captureResourceDeltas(now) {
    const elapsedMs = this.previousResourceAt > 0 ? now - this.previousResourceAt : 0;
    const processCpu = (0, import_node_process.cpuUsage)();
    const systemCpu = readSystemCpuCounters();
    const disk = readSystemDiskCounters();
    let cpuProcessPercent = null;
    let cpuSystemPercent = null;
    let diskReadBytesPerSecond = null;
    let diskWriteBytesPerSecond = null;
    if (elapsedMs > 0 && this.previousProcessCpu && systemCpu) {
      const usedMicros = processCpu.user - this.previousProcessCpu.user + processCpu.system - this.previousProcessCpu.system;
      const capacityMicros = elapsedMs * 1e3 * systemCpu.logicalCores;
      cpuProcessPercent = clampPercent(usedMicros / capacityMicros * 100);
    }
    if (this.previousSystemCpu && systemCpu) {
      const totalDelta = systemCpu.total - this.previousSystemCpu.total;
      const idleDelta = systemCpu.idle - this.previousSystemCpu.idle;
      if (totalDelta > 0) cpuSystemPercent = clampPercent((totalDelta - idleDelta) / totalDelta * 100);
    }
    if (elapsedMs > 0 && this.previousDisk && disk) {
      const seconds = elapsedMs / 1e3;
      diskReadBytesPerSecond = Math.max(0, disk.readBytes - this.previousDisk.readBytes) / seconds;
      diskWriteBytesPerSecond = Math.max(0, disk.writeBytes - this.previousDisk.writeBytes) / seconds;
    }
    this.previousProcessCpu = processCpu;
    this.previousSystemCpu = systemCpu;
    this.previousDisk = disk;
    this.previousResourceAt = now;
    this.diskStatus = disk ? "\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442" : "\u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D";
    return {
      cpuProcessPercent,
      cpuSystemPercent,
      diskReadBytesPerSecond,
      diskWriteBytesPerSecond
    };
  }
  async pollGpu() {
    if (this.paused || this.gpuBusy || Date.now() < this.gpuRetryAt) return;
    this.gpuBusy = true;
    try {
      this.gpuReading = await queryNvidiaGpu();
      this.gpuStatus = "\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442";
      this.gpuMessage = this.gpuReading.name;
      this.gpuRetryAt = 0;
    } catch (error) {
      this.gpuReading = null;
      this.gpuStatus = "\u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430";
      this.gpuMessage = `nvidia-smi \u043D\u0435 \u043E\u0442\u0432\u0435\u0442\u0438\u043B: ${errorMessage(error)}`;
      this.gpuRetryAt = Date.now() + 6e4;
    } finally {
      this.gpuBusy = false;
      this.emit();
    }
  }
  trimHistory() {
    const cutoff = Date.now() - this.settings.historyMinutes * 6e4;
    const firstValid = this.samples.findIndex((sample) => sample.at >= cutoff);
    if (firstValid > 0) this.samples.splice(0, firstValid);
    if (firstValid === -1) this.samples = [];
  }
  async startProfiler() {
    if (this.paused || this.session || this.profileBusy) return;
    this.profileBusy = true;
    try {
      const session = new import_node_inspector.Session();
      session.connect();
      this.session = session;
      await this.post("HeapProfiler.enable");
      await this.post("HeapProfiler.startSampling", {
        samplingInterval: 32768,
        stackDepth: 128,
        includeObjectsCollectedByMajorGC: false,
        includeObjectsCollectedByMinorGC: false
      });
      this.profilerStartedAt = Date.now();
      this.profilerStatus = "\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442";
      this.profilerMessage = "\u041D\u0430\u0431\u043B\u044E\u0434\u0430\u044E \u0436\u0438\u0432\u044B\u0435 \u0432\u044B\u0434\u0435\u043B\u0435\u043D\u0438\u044F JavaScript-\u043F\u0430\u043C\u044F\u0442\u0438";
    } catch (error) {
      this.profilerStatus = "\u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D";
      this.profilerMessage = `\u041F\u0440\u043E\u0444\u0438\u043B\u0438\u0440\u043E\u0432\u0449\u0438\u043A V8 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D: ${errorMessage(error)}`;
      this.disconnectSession();
    } finally {
      this.profileBusy = false;
      this.emit();
    }
  }
  async captureProfile() {
    if (this.paused || this.profileBusy) return;
    if (!this.session) {
      await this.startProfiler();
      return;
    }
    this.profileBusy = true;
    try {
      const response = await this.post("HeapProfiler.getSamplingProfile");
      const result = aggregateProfile(response.profile, this.pluginManifests());
      this.allocations = limitRows(result.rows, this.settings.maxPluginRows);
      this.totalSampledBytes = result.totalBytes;
      this.recognizedBytes = result.recognizedBytes;
      this.lastProfileAt = Date.now();
      this.profilerStatus = "\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442";
      this.profilerMessage = "\u0412\u044B\u0431\u043E\u0440\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0430";
    } catch (error) {
      this.profilerStatus = "\u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D";
      this.profilerMessage = `\u0421\u0432\u044F\u0437\u044C \u0441 \u043F\u0440\u043E\u0444\u0438\u043B\u0438\u0440\u043E\u0432\u0449\u0438\u043A\u043E\u043C \u043F\u043E\u0442\u0435\u0440\u044F\u043D\u0430: ${errorMessage(error)}`;
      this.disconnectSession();
    } finally {
      this.profileBusy = false;
      this.emit();
    }
  }
  async restartProfiler() {
    await this.stopProfiler();
    this.profilerStatus = "\u0437\u0430\u043F\u0443\u0441\u043A";
    this.profilerMessage = "\u041D\u0430\u0447\u0438\u043D\u0430\u044E \u043D\u043E\u0432\u0443\u044E \u0432\u044B\u0431\u043E\u0440\u043A\u0443\u2026";
    await this.startProfiler();
  }
  async stopProfiler() {
    if (!this.session) return;
    try {
      await this.post("HeapProfiler.stopSampling");
      await this.post("HeapProfiler.disable");
    } catch {
    } finally {
      this.disconnectSession();
    }
  }
  disconnectSession() {
    if (!this.session) return;
    try {
      this.session.disconnect();
    } catch {
    }
    this.session = null;
  }
  post(method, params) {
    const session = this.session;
    if (!session) return Promise.reject(new Error("\u043D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u0441\u0435\u0430\u043D\u0441\u0430"));
    return new Promise((resolve, reject) => {
      const callback = (error, response) => {
        if (error) reject(error);
        else resolve(response ?? {});
      };
      const post = session.post.bind(session);
      post(method, params ?? {}, callback);
    });
  }
  pluginManifests() {
    return this.app.plugins?.manifests ?? {};
  }
  emit() {
    const snapshot = this.snapshot();
    for (const subscriber of this.subscribers) subscriber(snapshot);
  }
};
function aggregateProfile(profile, manifests) {
  const bytesById = /* @__PURE__ */ new Map();
  let totalBytes = 0;
  let recognizedBytes = 0;
  const pluginIds = Object.keys(manifests).sort((a, b) => b.length - a.length);
  const visit = (node) => {
    const bytes = Math.max(0, node.selfSize ?? 0);
    if (bytes > 0) {
      const pluginId = matchPluginId(node.callFrame?.url ?? "", pluginIds);
      const bucket = pluginId ?? UNKNOWN_ID;
      bytesById.set(bucket, (bytesById.get(bucket) ?? 0) + bytes);
      totalBytes += bytes;
      if (pluginId) recognizedBytes += bytes;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(profile.head);
  const rows = Array.from(bytesById.entries()).map(([id, bytes]) => {
    const recognized = id !== UNKNOWN_ID;
    return {
      id,
      name: recognized ? manifests[id]?.name ?? id : "Obsidian \u0438 \u043D\u0435\u0440\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u043D\u043D\u043E\u0435",
      bytes,
      percent: totalBytes > 0 ? bytes / totalBytes * 100 : 0,
      color: recognized ? colorForId(id) : "#778091",
      recognized
    };
  });
  rows.sort((a, b) => b.bytes - a.bytes);
  return { rows, totalBytes, recognizedBytes };
}
function matchPluginId(url, pluginIds) {
  if (!url) return null;
  let normalized = url.replace(/\\/g, "/").toLowerCase();
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
  }
  for (const id of pluginIds) {
    const needle = id.toLowerCase();
    if (normalized.includes(`/.obsidian/plugins/${needle}/`) || normalized.includes(`/plugins/${needle}/`) || normalized.includes(`plugin:${needle}`) || normalized.endsWith(`/${needle}/main.js`) || normalized.endsWith(`/${needle}/main.js?`)) {
      return id;
    }
  }
  return null;
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 \u0411";
  const units = ["\u0411", "\u041A\u0438\u0411", "\u041C\u0438\u0411", "\u0413\u0438\u0411"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unit;
  const digits = unit >= 2 && value < 100 ? 1 : 0;
  return `${value.toFixed(digits).replace(".", ",")} ${units[unit]}`;
}
function colorForId(id) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = id.charCodeAt(index) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 74% 62%)`;
}
function limitRows(rows, limit) {
  if (rows.length <= limit) return rows;
  const visible = rows.slice(0, Math.max(1, limit));
  const unknown = rows.find((row) => !row.recognized);
  if (unknown && !visible.includes(unknown)) visible[visible.length - 1] = unknown;
  return visible;
}
function readSystemCpuCounters() {
  const cores = (0, import_node_os.cpus)();
  if (cores.length === 0) return null;
  let idle = 0;
  let total = 0;
  for (const core of cores) {
    const times = core.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total, logicalCores: cores.length };
}
function readSystemDiskCounters() {
  if (import_node_process.platform !== "linux") return null;
  try {
    const lines = (0, import_node_fs.readFileSync)("/proc/diskstats", "utf8").split("\n");
    let readSectors = 0;
    let writeSectors = 0;
    let devices = 0;
    for (const line of lines) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 10 || !isPhysicalDisk(fields[2] ?? "")) continue;
      const reads = Number(fields[5]);
      const writes = Number(fields[9]);
      if (!Number.isFinite(reads) || !Number.isFinite(writes)) continue;
      readSectors += reads;
      writeSectors += writes;
      devices += 1;
    }
    if (devices === 0) return null;
    return {
      readBytes: readSectors * 512,
      writeBytes: writeSectors * 512
    };
  } catch {
    return null;
  }
}
function isPhysicalDisk(name) {
  return /^(nvme\d+n\d+|sd[a-z]+|vd[a-z]+|xvd[a-z]+|mmcblk\d+|md\d+)$/.test(name);
}
async function queryNvidiaGpu() {
  const commands = import_node_process.platform === "linux" ? ["nvidia-smi", "/run/current-system/sw/bin/nvidia-smi", "/usr/bin/nvidia-smi"] : ["nvidia-smi"];
  let lastError = new Error("\u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430");
  for (const command of commands) {
    try {
      const output = await execFileUtf8(command, [
        "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
        "--format=csv,noheader,nounits"
      ]);
      return parseNvidiaOutput(output);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
function parseNvidiaOutput(output) {
  const firstLine = output.trim().split("\n")[0];
  const fields = firstLine?.split(",").map((field) => field.trim()) ?? [];
  const utilization = Number(fields[1]);
  const memoryUsedMiB = Number(fields[2]);
  const memoryTotalMiB = Number(fields[3]);
  const temperature = Number(fields[4]);
  if (!fields[0] || !Number.isFinite(utilization) || !Number.isFinite(memoryUsedMiB) || !Number.isFinite(memoryTotalMiB)) {
    throw new Error("\u043F\u043E\u043B\u0443\u0447\u0435\u043D \u043D\u0435\u043F\u043E\u043B\u043D\u044B\u0439 \u043E\u0442\u0432\u0435\u0442");
  }
  return {
    name: fields[0],
    utilization: clampPercent(utilization),
    memoryUsed: memoryUsedMiB * 1024 ** 2,
    memoryTotal: memoryTotalMiB * 1024 ** 2,
    temperature: Number.isFinite(temperature) ? temperature : null
  };
}
function execFileUtf8(command, args) {
  return new Promise((resolve, reject) => {
    (0, import_node_child_process.execFile)(
      command,
      args,
      { encoding: "utf8", timeout: 2e3, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      }
    );
  });
}
function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/settings.ts
var import_obsidian = require("obsidian");
var MemoryMonitorSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("mm-settings");
    containerEl.createEl("h2", { text: "\u041C\u043E\u043D\u0438\u0442\u043E\u0440 \u0440\u0435\u0441\u0443\u0440\u0441\u043E\u0432" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "\u0427\u0435\u0442\u044B\u0440\u0435 \u0433\u0440\u0430\u0444\u0438\u043A\u0430 \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u044E\u0442 \u041E\u0417\u0423, \u0426\u041F, \u0432\u0438\u0434\u0435\u043E\u043A\u0430\u0440\u0442\u0443 \u0438 \u043D\u0430\u043A\u043E\u043F\u0438\u0442\u0435\u043B\u0438. \u041D\u0438\u0436\u043D\u044F\u044F \u0440\u0430\u0437\u0431\u0438\u0432\u043A\u0430 \u043F\u0440\u0438\u0431\u043B\u0438\u0437\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u0440\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u044F\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0436\u0438\u0432\u044B\u0435 JavaScript-\u0432\u044B\u0434\u0435\u043B\u0435\u043D\u0438\u044F, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0437\u0430\u043C\u0435\u0442\u0438\u043B \u043F\u0440\u043E\u0444\u0438\u043B\u0438\u0440\u043E\u0432\u0449\u0438\u043A V8."
    });
    new import_obsidian.Setting(containerEl).setName("\u0427\u0430\u0441\u0442\u043E\u0442\u0430 \u0433\u0440\u0430\u0444\u0438\u043A\u0430").setDesc("\u041A\u0430\u043A \u0447\u0430\u0441\u0442\u043E \u0441\u0447\u0438\u0442\u044B\u0432\u0430\u0442\u044C \u043F\u0430\u043C\u044F\u0442\u044C \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u0430. \u041E\u0434\u043D\u0430 \u0441\u0435\u043A\u0443\u043D\u0434\u0430 \u2014 \u0440\u0430\u0437\u0443\u043C\u043D\u044B\u0439 \u0431\u0430\u043B\u0430\u043D\u0441.").addDropdown((dropdown) => dropdown.addOptions({ "500": "\u041A\u0430\u0436\u0434\u044B\u0435 0,5 \u0441", "1000": "\u041A\u0430\u0436\u0434\u0443\u044E \u0441\u0435\u043A\u0443\u043D\u0434\u0443", "2000": "\u041A\u0430\u0436\u0434\u044B\u0435 2 \u0441" }).setValue(String(this.plugin.settings.sampleIntervalMs)).onChange(async (value) => {
      await this.plugin.updateSettings({ sampleIntervalMs: Number(value) });
    }));
    new import_obsidian.Setting(containerEl).setName("\u0425\u0440\u0430\u043D\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E").setDesc("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0436\u0438\u0432\u0451\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0432 \u043F\u0430\u043C\u044F\u0442\u0438 \u0438 \u0441\u0431\u0440\u0430\u0441\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043F\u043E\u0441\u043B\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F Obsidian.").addDropdown((dropdown) => dropdown.addOptions({ "5": "5 \u043C\u0438\u043D\u0443\u0442", "15": "15 \u043C\u0438\u043D\u0443\u0442", "30": "30 \u043C\u0438\u043D\u0443\u0442" }).setValue(String(this.plugin.settings.historyMinutes)).onChange(async (value) => {
      await this.plugin.updateSettings({ historyMinutes: Number(value) });
    }));
    new import_obsidian.Setting(containerEl).setName("\u041E\u0431\u043D\u043E\u0432\u043B\u044F\u0442\u044C \u0434\u043E\u043B\u0438 \u0434\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0439").setDesc("\u0427\u0430\u0449\u0435 \u2014 \u043E\u0442\u0437\u044B\u0432\u0447\u0438\u0432\u0435\u0435, \u043D\u043E \u043D\u0435\u043C\u043D\u043E\u0433\u043E \u0431\u043E\u043B\u044C\u0448\u0435 \u0441\u043B\u0443\u0436\u0435\u0431\u043D\u043E\u0439 \u0440\u0430\u0431\u043E\u0442\u044B V8.").addDropdown((dropdown) => dropdown.addOptions({ "5000": "\u041A\u0430\u0436\u0434\u044B\u0435 5 \u0441", "10000": "\u041A\u0430\u0436\u0434\u044B\u0435 10 \u0441", "30000": "\u041A\u0430\u0436\u0434\u044B\u0435 30 \u0441" }).setValue(String(this.plugin.settings.profileIntervalMs)).onChange(async (value) => {
      await this.plugin.updateSettings({ profileIntervalMs: Number(value) });
    }));
    new import_obsidian.Setting(containerEl).setName("\u0421\u0442\u0440\u043E\u043A \u0432 \u0440\u0430\u0437\u0431\u0438\u0432\u043A\u0435").setDesc("\u041E\u0441\u0442\u0430\u043B\u044C\u043D\u044B\u0435 \u0434\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F \u0441 \u043C\u0435\u043D\u044C\u0448\u0435\u0439 \u0434\u043E\u043B\u0435\u0439 \u043D\u0435 \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u044E\u0442\u0441\u044F.").addDropdown((dropdown) => dropdown.addOptions({ "10": "10", "20": "20", "35": "35" }).setValue(String(this.plugin.settings.maxPluginRows)).onChange(async (value) => {
      await this.plugin.updateSettings({ maxPluginRows: Number(value) });
    }));
    const warning = containerEl.createDiv({ cls: "mm-settings-note" });
    warning.createEl("strong", { text: "\u0413\u0440\u0430\u043D\u0438\u0446\u0430 \u0442\u043E\u0447\u043D\u043E\u0441\u0442\u0438" });
    warning.createDiv({
      text: "\u0414\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435 \u043D\u0435 \u043C\u043E\u0436\u0435\u0442 \u0447\u0435\u0441\u0442\u043D\u043E \u0440\u0430\u0437\u043B\u043E\u0436\u0438\u0442\u044C \u0432\u0441\u044E \u041E\u0417\u0423 \u043F\u043E \u0432\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u0430\u043C: \u0447\u0430\u0441\u0442\u044C \u043F\u0430\u043C\u044F\u0442\u0438 \u0432\u044B\u0434\u0435\u043B\u044F\u0435\u0442 Chromium, \u043D\u0430\u0442\u0438\u0432\u043D\u044B\u0435 \u0431\u0438\u0431\u043B\u0438\u043E\u0442\u0435\u043A\u0438, \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F \u0438 \u0441\u0430\u043C\u043E \u044F\u0434\u0440\u043E Obsidian. \u041F\u043E\u044D\u0442\u043E\u043C\u0443 \u043F\u043E\u043B\u043D\u044B\u0439 \u043E\u0431\u044A\u0451\u043C \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E \u043E\u0442 \u0432\u044B\u0431\u043E\u0440\u043E\u0447\u043D\u043E\u0439 \u0440\u0430\u0437\u0431\u0438\u0432\u043A\u0438."
    });
  }
};

// src/types.ts
var DEFAULT_SETTINGS = {
  sampleIntervalMs: 1e3,
  historyMinutes: 15,
  profileIntervalMs: 1e4,
  maxPluginRows: 20
};

// src/view.ts
var import_obsidian2 = require("obsidian");
var MEMORY_MONITOR_VIEW = "memory-monitor-ru-view";
var SVG_NS = "http://www.w3.org/2000/svg";
var MemoryMonitorView = class extends import_obsidian2.ItemView {
  constructor(leaf, monitor) {
    super(leaf);
    this.unsubscribe = null;
    this.rangeMinutes = 5;
    this.monitor = monitor;
  }
  getViewType() {
    return MEMORY_MONITOR_VIEW;
  }
  getDisplayText() {
    return "\u041C\u043E\u043D\u0438\u0442\u043E\u0440 \u0440\u0435\u0441\u0443\u0440\u0441\u043E\u0432";
  }
  getIcon() {
    return "activity";
  }
  async onOpen() {
    this.containerEl.addClass("memory-monitor-view");
    this.unsubscribe = this.monitor.subscribe((snapshot) => this.render(snapshot));
  }
  async onClose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
  render(snapshot) {
    const root = this.contentEl;
    const scrollTop = root.scrollTop;
    root.empty();
    root.addClass("mm-root");
    const visible = samplesInRange(snapshot.samples, this.rangeMinutes);
    const current = visible[visible.length - 1] ?? snapshot.samples[snapshot.samples.length - 1];
    this.renderHeader(root, snapshot);
    this.renderMemory(root, visible, current);
    this.renderCpu(root, visible, current);
    this.renderGpu(root, visible, current, snapshot);
    this.renderDisk(root, visible, current, snapshot);
    this.renderBreakdown(root, snapshot);
    root.scrollTop = scrollTop;
  }
  renderHeader(root, snapshot) {
    const header = root.createDiv({ cls: "mm-header" });
    const heading = header.createDiv({ cls: "mm-heading" });
    heading.createDiv({ cls: "mm-eyebrow", text: "OBSIDIAN \xB7 \u0421\u0418\u0421\u0422\u0415\u041C\u041D\u042B\u0415 \u0420\u0415\u0421\u0423\u0420\u0421\u042B" });
    heading.createEl("h2", { text: "\u0420\u0435\u0441\u0443\u0440\u0441\u044B \u0431\u0435\u0437 \u0433\u0430\u0434\u0430\u043D\u0438\u0439" });
    const actions = header.createDiv({ cls: "mm-actions" });
    const range = actions.createEl("select", {
      cls: "dropdown mm-range mm-header-range",
      attr: {
        "aria-label": "\u041F\u0440\u043E\u043C\u0435\u0436\u0443\u0442\u043E\u043A \u0432\u0441\u0435\u0445 \u0433\u0440\u0430\u0444\u0438\u043A\u043E\u0432",
        title: "\u041F\u0440\u043E\u043C\u0435\u0436\u0443\u0442\u043E\u043A \u0432\u0441\u0435\u0445 \u0447\u0435\u0442\u044B\u0440\u0451\u0445 \u0433\u0440\u0430\u0444\u0438\u043A\u043E\u0432"
      }
    });
    for (const minutes of [1, 5, 15]) {
      const option = range.createEl("option", {
        text: `${minutes} \u043C\u0438\u043D`,
        value: String(minutes)
      });
      option.selected = minutes === this.rangeMinutes;
    }
    range.addEventListener("change", () => {
      this.rangeMinutes = Number(range.value);
      this.render(this.monitor.snapshot());
    });
    const pause = actions.createEl("button", {
      cls: "clickable-icon mm-icon-button",
      attr: { "aria-label": snapshot.paused ? "\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C \u0438\u0437\u043C\u0435\u0440\u0435\u043D\u0438\u0435" : "\u041F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0438\u0437\u043C\u0435\u0440\u0435\u043D\u0438\u0435" }
    });
    (0, import_obsidian2.setIcon)(pause, snapshot.paused ? "play" : "pause");
    pause.addEventListener("click", () => this.monitor.setPaused(!snapshot.paused));
    const reset = actions.createEl("button", {
      cls: "clickable-icon mm-icon-button",
      attr: { "aria-label": "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0438 \u043D\u0430\u0447\u0430\u0442\u044C \u043D\u043E\u0432\u0443\u044E \u0432\u044B\u0431\u043E\u0440\u043A\u0443" }
    });
    (0, import_obsidian2.setIcon)(reset, "rotate-ccw");
    reset.addEventListener("click", () => this.monitor.reset());
  }
  renderMemory(root, samples, current) {
    const section = this.resourceSection(
      root,
      "\u041E\u0417\u0423",
      "\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u043F\u0440\u043E\u0446\u0435\u0441\u0441 Obsidian: \u0440\u0435\u0434\u0430\u043A\u0442\u043E\u0440, \u0434\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F \u0438 \u043A\u043E\u0434"
    );
    const metrics = section.createDiv({ cls: "mm-metrics" });
    this.metric(metrics, "\u0412 \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u0435", current ? formatBytes(current.rss) : "\u2014", "mm-cyan");
    this.metric(metrics, "\u041A\u0443\u0447\u0430 JavaScript", current ? formatBytes(current.heapUsed) : "\u2014", "mm-pink");
    this.metric(metrics, "\u0412\u043D\u0435\u0448\u043D\u044F\u044F \u043F\u0430\u043C\u044F\u0442\u044C", current ? formatBytes(current.external) : "\u2014", "mm-violet");
    const series = [
      { label: "\u0412\u0435\u0441\u044C \u043F\u0440\u043E\u0446\u0435\u0441\u0441", color: "#68e8ee", value: (sample) => sample.rss },
      { label: "\u041A\u0443\u0447\u0430 JavaScript", color: "#ff77b7", value: (sample) => sample.heapUsed }
    ];
    section.appendChild(createResourceChart(samples, series, {
      ariaLabel: "\u0413\u0440\u0430\u0444\u0438\u043A \u043E\u043F\u0435\u0440\u0430\u0442\u0438\u0432\u043D\u043E\u0439 \u043F\u0430\u043C\u044F\u0442\u0438 \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u0430 Obsidian",
      minimumMax: 64 * 1024 ** 2,
      formatAxis: formatBytes
    }));
    this.renderLegend(section, series, samples.length);
  }
  renderCpu(root, samples, current) {
    const section = this.resourceSection(
      root,
      "\u0426\u041F",
      "\u0414\u043E\u043B\u044F \u0432\u0441\u0435\u0433\u043E \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u043E\u0440\u0430: \u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u043F\u0440\u043E\u0446\u0435\u0441\u0441 Obsidian \u0438 \u043A\u043E\u043C\u043F\u044C\u044E\u0442\u0435\u0440 \u0446\u0435\u043B\u0438\u043A\u043E\u043C"
    );
    const metrics = section.createDiv({ cls: "mm-metrics mm-metrics-two" });
    this.metric(metrics, "\u041F\u0440\u043E\u0446\u0435\u0441\u0441 Obsidian", formatPercent(current?.cpuProcessPercent), "mm-pink");
    this.metric(metrics, "\u0412\u0441\u044F \u0441\u0438\u0441\u0442\u0435\u043C\u0430", formatPercent(current?.cpuSystemPercent), "mm-cyan");
    const series = [
      { label: "\u041F\u0440\u043E\u0446\u0435\u0441\u0441 Obsidian", color: "#ff77b7", value: (sample) => sample.cpuProcessPercent },
      { label: "\u0412\u0441\u044F \u0441\u0438\u0441\u0442\u0435\u043C\u0430", color: "#68e8ee", value: (sample) => sample.cpuSystemPercent }
    ];
    section.appendChild(createResourceChart(samples, series, {
      ariaLabel: "\u0413\u0440\u0430\u0444\u0438\u043A \u043D\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u0446\u0435\u043D\u0442\u0440\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u043E\u0440\u0430",
      fixedMax: 100,
      minimumMax: 100,
      formatAxis: formatAxisPercent
    }));
    this.renderLegend(section, series, samples.length);
  }
  renderGpu(root, samples, current, snapshot) {
    const section = this.resourceSection(
      root,
      "\u0412\u0438\u0434\u0435\u043E\u043A\u0430\u0440\u0442\u0430",
      snapshot.gpuStatus === "\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442" ? snapshot.gpuMessage : "\u0412\u0441\u044F \u0432\u0438\u0434\u0435\u043E\u043A\u0430\u0440\u0442\u0430 \u0447\u0435\u0440\u0435\u0437 \u0441\u0440\u0435\u0434\u0441\u0442\u0432\u0430 NVIDIA",
      snapshot.gpuStatus,
      snapshot.gpuMessage
    );
    const memoryPercent = current?.gpuMemoryUsed !== null && current?.gpuMemoryUsed !== void 0 && current.gpuMemoryTotal ? current.gpuMemoryUsed / current.gpuMemoryTotal * 100 : null;
    const metrics = section.createDiv({ cls: "mm-metrics" });
    this.metric(metrics, "\u041D\u0430\u0433\u0440\u0443\u0437\u043A\u0430", formatPercent(current?.gpuUtilPercent), "mm-green");
    this.metric(metrics, "\u0412\u0438\u0434\u0435\u043E\u043F\u0430\u043C\u044F\u0442\u044C", current?.gpuMemoryUsed !== null && current?.gpuMemoryUsed !== void 0 ? formatBytes(current.gpuMemoryUsed) : "\u2014", "mm-violet");
    this.metric(metrics, "\u0422\u0435\u043C\u043F\u0435\u0440\u0430\u0442\u0443\u0440\u0430", current?.gpuTemperature !== null && current?.gpuTemperature !== void 0 ? `${current.gpuTemperature.toFixed(0)} \xB0C` : "\u2014", "mm-orange");
    const series = [
      { label: "\u041D\u0430\u0433\u0440\u0443\u0437\u043A\u0430", color: "#72e6a3", value: (sample) => sample.gpuUtilPercent },
      {
        label: "\u0417\u0430\u043D\u044F\u0442\u043E \u0432\u0438\u0434\u0435\u043E\u043F\u0430\u043C\u044F\u0442\u0438",
        color: "#a895ff",
        value: (sample) => sample.gpuMemoryUsed !== null && sample.gpuMemoryTotal ? sample.gpuMemoryUsed / sample.gpuMemoryTotal * 100 : null
      }
    ];
    section.appendChild(createResourceChart(samples, series, {
      ariaLabel: "\u0413\u0440\u0430\u0444\u0438\u043A \u043D\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u0432\u0438\u0434\u0435\u043E\u043A\u0430\u0440\u0442\u044B \u0438 \u0432\u0438\u0434\u0435\u043E\u043F\u0430\u043C\u044F\u0442\u0438",
      fixedMax: 100,
      minimumMax: 100,
      formatAxis: formatAxisPercent
    }));
    this.renderLegend(section, series, samples.length);
    if (snapshot.gpuStatus === "\u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430") {
      section.createDiv({
        cls: "mm-inline-warning",
        text: "\u041D\u0435\u0442 \u043E\u0442\u0432\u0435\u0442\u0430 \u043E\u0442 nvidia-smi. \u0413\u0440\u0430\u0444\u0438\u043A \u0437\u0430\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438, \u043A\u043E\u0433\u0434\u0430 \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u0441\u0442\u0430\u043D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430."
      });
    } else if (memoryPercent !== null) {
      section.setAttr("data-gpu-memory-percent", memoryPercent.toFixed(1));
    }
  }
  renderDisk(root, samples, current, snapshot) {
    const section = this.resourceSection(
      root,
      "SSD",
      "\u041E\u0431\u0449\u0430\u044F \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u0444\u0438\u0437\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u043D\u0430\u043A\u043E\u043F\u0438\u0442\u0435\u043B\u0435\u0439 Linux",
      snapshot.diskStatus,
      snapshot.diskStatus === "\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442" ? "\u0427\u0438\u0442\u0430\u044E /proc/diskstats" : "\u0421\u0438\u0441\u0442\u0435\u043C\u043D\u044B\u0435 \u0441\u0447\u0451\u0442\u0447\u0438\u043A\u0438 \u043D\u0430\u043A\u043E\u043F\u0438\u0442\u0435\u043B\u0435\u0439 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B"
    );
    const metrics = section.createDiv({ cls: "mm-metrics mm-metrics-two" });
    this.metric(metrics, "\u0427\u0442\u0435\u043D\u0438\u0435", formatRate(current?.diskReadBytesPerSecond), "mm-cyan");
    this.metric(metrics, "\u0417\u0430\u043F\u0438\u0441\u044C", formatRate(current?.diskWriteBytesPerSecond), "mm-pink");
    const series = [
      { label: "\u0427\u0442\u0435\u043D\u0438\u0435", color: "#68e8ee", value: (sample) => sample.diskReadBytesPerSecond },
      { label: "\u0417\u0430\u043F\u0438\u0441\u044C", color: "#ff77b7", value: (sample) => sample.diskWriteBytesPerSecond }
    ];
    section.appendChild(createResourceChart(samples, series, {
      ariaLabel: "\u0413\u0440\u0430\u0444\u0438\u043A \u0447\u0442\u0435\u043D\u0438\u044F \u0438 \u0437\u0430\u043F\u0438\u0441\u0438 \u0444\u0438\u0437\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u043D\u0430\u043A\u043E\u043F\u0438\u0442\u0435\u043B\u0435\u0439",
      minimumMax: 1024 ** 2,
      formatAxis: formatRate
    }));
    this.renderLegend(section, series, samples.length);
  }
  resourceSection(root, titleText, subtitle, status, statusMessage) {
    const section = root.createEl("section", { cls: "mm-section mm-resource" });
    const top = section.createDiv({ cls: "mm-section-top" });
    const title = top.createDiv();
    title.createEl("h3", { text: titleText });
    title.createDiv({ cls: "mm-muted", text: subtitle });
    if (status) {
      const chip = top.createDiv({ cls: `mm-status mm-status-${genericStatusClass(status)}` });
      chip.createSpan({ cls: "mm-status-dot" });
      chip.createSpan({ text: status });
      if (statusMessage) chip.setAttr("title", statusMessage);
    }
    return section;
  }
  metric(parent, label, value, colorClass) {
    const metric = parent.createDiv({ cls: `mm-metric ${colorClass}` });
    metric.createDiv({ cls: "mm-metric-label", text: label });
    metric.createDiv({ cls: "mm-metric-value", text: value });
  }
  renderLegend(parent, series, sampleCount) {
    const legend = parent.createDiv({ cls: "mm-legend" });
    for (const item of series) {
      const entry = legend.createSpan({ cls: "mm-legend-item", text: item.label });
      entry.style.setProperty("--mm-series-color", item.color);
    }
    legend.createSpan({
      cls: "mm-chart-caption",
      text: sampleCount > 1 ? `${sampleCount} \u0442\u043E\u0447\u0435\u043A` : "\u0416\u0434\u0443 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0437\u0430\u043C\u0435\u0440\u2026"
    });
  }
  renderBreakdown(root, snapshot) {
    const section = root.createEl("section", { cls: "mm-section mm-breakdown" });
    const top = section.createDiv({ cls: "mm-section-top" });
    const title = top.createDiv();
    title.createEl("h3", { text: "\u041A\u0442\u043E \u0432\u044B\u0434\u0435\u043B\u044F\u0435\u0442 JavaScript-\u043F\u0430\u043C\u044F\u0442\u044C" });
    title.createDiv({
      cls: "mm-muted",
      text: "\u041F\u0440\u0438\u0431\u043B\u0438\u0436\u0451\u043D\u043D\u0430\u044F \u0434\u043E\u043B\u044F \u0436\u0438\u0432\u044B\u0445 \u0432\u044B\u0434\u0435\u043B\u0435\u043D\u0438\u0439, \u0437\u0430\u043C\u0435\u0447\u0435\u043D\u043D\u044B\u0445 V8 \u043F\u043E\u0441\u043B\u0435 \u0437\u0430\u043F\u0443\u0441\u043A\u0430"
    });
    const status = top.createDiv({ cls: `mm-status mm-status-${profilerStatusClass(snapshot)}` });
    status.createSpan({ cls: "mm-status-dot" });
    status.createSpan({ text: snapshot.profilerStatus });
    status.setAttr("title", snapshot.profilerMessage);
    if (snapshot.totalSampledBytes <= 0 || snapshot.allocations.length === 0) {
      const empty = section.createDiv({ cls: "mm-empty" });
      const icon = empty.createDiv({ cls: "mm-empty-icon" });
      (0, import_obsidian2.setIcon)(icon, "scan-search");
      empty.createEl("strong", { text: "\u041D\u0430\u0431\u0438\u0440\u0430\u044E \u0432\u044B\u0431\u043E\u0440\u043A\u0443" });
      empty.createDiv({
        text: snapshot.profilerStatus === "\u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D" ? snapshot.profilerMessage : "\u041F\u0435\u0440\u0432\u044B\u0435 \u0434\u043E\u043B\u0438 \u043E\u0431\u044B\u0447\u043D\u043E \u043F\u043E\u044F\u0432\u043B\u044F\u044E\u0442\u0441\u044F \u0447\u0435\u0440\u0435\u0437 10\u201330 \u0441\u0435\u043A\u0443\u043D\u0434 \u043E\u0431\u044B\u0447\u043D\u043E\u0439 \u0440\u0430\u0431\u043E\u0442\u044B."
      });
      return;
    }
    const quality = section.createDiv({ cls: "mm-quality" });
    quality.createSpan({
      text: `\u0420\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u043D\u043E \u0434\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0439: ${ratioPercent(snapshot.recognizedBytes, snapshot.totalSampledBytes)}`
    });
    quality.createSpan({ text: `\u041E\u0431\u044A\u0451\u043C \u0432\u044B\u0431\u043E\u0440\u043A\u0438: ${formatBytes(snapshot.totalSampledBytes)}` });
    const list = section.createDiv({ cls: "mm-plugin-list" });
    for (const row of snapshot.allocations) this.renderAllocationRow(list, row);
    const note = section.createDiv({ cls: "mm-honesty-note" });
    const noteIcon = note.createSpan();
    (0, import_obsidian2.setIcon)(noteIcon, "info");
    note.createSpan({
      text: "\u042D\u0442\u043E \u043D\u0435 \u0434\u043E\u043B\u044F \u043E\u0442 \u0432\u0441\u0435\u0439 \u041E\u0417\u0423. V8 \u0432\u044B\u0431\u043E\u0440\u043E\u0447\u043D\u043E \u0441\u0447\u0438\u0442\u0430\u0435\u0442 \u0436\u0438\u0432\u044B\u0435 JavaScript-\u043E\u0431\u044A\u0435\u043A\u0442\u044B; \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F, \u0431\u0430\u0437\u044B, \u043D\u0430\u0442\u0438\u0432\u043D\u044B\u0439 \u043A\u043E\u0434 \u0438 \u0447\u0430\u0441\u0442\u044C \u044F\u0434\u0440\u0430 \u043F\u043E\u043F\u0430\u0434\u0430\u044E\u0442 \u0432 \u043E\u0431\u0449\u0438\u0439 \u043F\u0440\u043E\u0446\u0435\u0441\u0441, \u043D\u043E \u043D\u0435 \u0440\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u044F\u044E\u0442\u0441\u044F \u043F\u043E \u0434\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F\u043C."
    });
  }
  renderAllocationRow(parent, row) {
    const item = parent.createDiv({ cls: `mm-plugin-row${row.recognized ? "" : " is-unknown"}` });
    const line = item.createDiv({ cls: "mm-plugin-line" });
    const identity = line.createDiv({ cls: "mm-plugin-identity" });
    const marker = identity.createSpan({ cls: "mm-plugin-marker" });
    marker.style.setProperty("--mm-row-color", row.color);
    const names = identity.createDiv({ cls: "mm-plugin-names" });
    names.createSpan({ cls: "mm-plugin-name", text: row.name });
    if (row.recognized) names.createSpan({ cls: "mm-plugin-id", text: row.id });
    const value = line.createDiv({ cls: "mm-plugin-value" });
    value.createEl("strong", { text: `${row.percent.toFixed(1).replace(".", ",")}%` });
    value.createSpan({ text: formatBytes(row.bytes) });
    const track = item.createDiv({ cls: "mm-bar-track" });
    const bar = track.createDiv({ cls: "mm-bar" });
    bar.style.width = `${Math.max(0.8, Math.min(100, row.percent))}%`;
    bar.style.setProperty("--mm-row-color", row.color);
  }
};
function samplesInRange(samples, minutes) {
  const cutoff = Date.now() - minutes * 6e4;
  const visible = samples.filter((sample) => sample.at >= cutoff);
  if (visible.length <= 360) return visible;
  const step = Math.ceil(visible.length / 360);
  const reduced = visible.filter((_, index) => index % step === 0);
  const last = visible[visible.length - 1];
  if (last && reduced[reduced.length - 1] !== last) reduced.push(last);
  return reduced;
}
function createResourceChart(samples, series, options) {
  const width = 720;
  const height = 180;
  const padding = { top: 14, right: 16, bottom: 26, left: 58 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const svg = svgEl("svg", {
    class: "mm-chart",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": options.ariaLabel
  });
  const values = samples.flatMap((sample) => series.map((item) => item.value(sample)).filter((value) => value !== null && Number.isFinite(value)));
  const rawMax = Math.max(options.minimumMax, ...values);
  const maxValue = options.fixedMax ?? niceChartMax(rawMax);
  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const y = padding.top + plotHeight * ratio;
    svg.appendChild(svgEl("line", {
      class: "mm-grid-line",
      x1: String(padding.left),
      x2: String(width - padding.right),
      y1: String(y),
      y2: String(y)
    }));
    const label = svgEl("text", {
      class: "mm-grid-label",
      x: String(padding.left - 9),
      y: String(y + 4),
      "text-anchor": "end"
    });
    label.textContent = options.formatAxis(maxValue * (1 - ratio));
    svg.appendChild(label);
  }
  for (const item of series) {
    const points = [];
    samples.forEach((sample, index) => {
      const value = item.value(sample);
      if (value === null || !Number.isFinite(value)) return;
      const x = padding.left + (samples.length <= 1 ? plotWidth : index / (samples.length - 1) * plotWidth);
      const y = padding.top + plotHeight - Math.max(0, value) / maxValue * plotHeight;
      points.push([x, y]);
    });
    if (points.length === 0) continue;
    const path = svgEl("path", {
      class: "mm-line",
      d: pathFor(points),
      stroke: item.color
    });
    svg.appendChild(path);
  }
  if (samples.length > 0) {
    const start = svgEl("text", {
      class: "mm-axis-time",
      x: String(padding.left),
      y: String(height - 5),
      "text-anchor": "start"
    });
    start.textContent = formatTime(samples[0]?.at ?? Date.now());
    svg.appendChild(start);
    const end = svgEl("text", {
      class: "mm-axis-time",
      x: String(width - padding.right),
      y: String(height - 5),
      "text-anchor": "end"
    });
    end.textContent = "\u0441\u0435\u0439\u0447\u0430\u0441";
    svg.appendChild(end);
  }
  return svg;
}
function svgEl(name, attrs = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}
function pathFor(points) {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
}
function niceChartMax(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}
function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
function formatPercent(value) {
  return value === null || value === void 0 ? "\u2014" : `${value.toFixed(1).replace(".", ",")}%`;
}
function formatAxisPercent(value) {
  return `${value.toFixed(0)}%`;
}
function formatRate(value) {
  return value === null || value === void 0 ? "\u2014" : `${formatBytes(value)}/\u0441`;
}
function ratioPercent(part, total) {
  return total > 0 ? `${(part / total * 100).toFixed(0)}%` : "0%";
}
function profilerStatusClass(snapshot) {
  if (snapshot.profilerStatus === "\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442") return "ok";
  if (snapshot.profilerStatus === "\u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D") return "error";
  return "idle";
}
function genericStatusClass(status) {
  if (status === "\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442") return "ok";
  if (status === "\u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430" || status === "\u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D") return "error";
  return "idle";
}

// src/main.ts
var MemoryMonitorPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
  }
  async onload() {
    await this.loadSettings();
    this.monitor = new MemoryMonitorService(this.app, this.settings);
    this.registerView(
      MEMORY_MONITOR_VIEW,
      (leaf) => new MemoryMonitorView(leaf, this.monitor)
    );
    this.addRibbonIcon("activity", "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043C\u043E\u043D\u0438\u0442\u043E\u0440 \u0440\u0435\u0441\u0443\u0440\u0441\u043E\u0432", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-memory-monitor",
      name: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043C\u043E\u043D\u0438\u0442\u043E\u0440 \u0440\u0435\u0441\u0443\u0440\u0441\u043E\u0432",
      callback: () => void this.activateView()
    });
    this.addCommand({
      id: "reset-memory-monitor",
      name: "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0438\u0437\u043C\u0435\u0440\u0435\u043D\u0438\u0439",
      callback: () => {
        this.monitor.reset();
        new import_obsidian3.Notice("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0440\u0435\u0441\u0443\u0440\u0441\u043E\u0432 \u0438 \u0432\u044B\u0431\u043E\u0440\u043A\u0430 \u0434\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0439 \u0441\u0431\u0440\u043E\u0448\u0435\u043D\u044B");
      }
    });
    this.addSettingTab(new MemoryMonitorSettingTab(this.app, this));
    this.monitor.start();
  }
  onunload() {
    this.monitor?.stop();
    this.app.workspace.detachLeavesOfType(MEMORY_MONITOR_VIEW);
  }
  async updateSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    await this.saveData(this.settings);
    this.monitor.configure(this.settings);
  }
  async loadSettings() {
    const saved = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...saved ?? {} };
  }
  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(MEMORY_MONITOR_VIEW)[0] ?? null;
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) {
        new import_obsidian3.Notice("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0440\u0430\u0432\u0443\u044E \u043F\u0430\u043D\u0435\u043B\u044C");
        return;
      }
      await leaf.setViewState({ type: MEMORY_MONITOR_VIEW, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }
};
