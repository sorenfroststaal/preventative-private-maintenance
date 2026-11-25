import { invoke } from "@tauri-apps/api/core";
import {
  SerializedDb,
  randomId,
  systemClock,
  type ClosableDb,
  type Env,
  type FileSystem,
  type Platform,
  type RawExecutor,
  type SqlValue,
  type Zipper,
} from "@ppm/core";

export interface AppInfo {
  pid: number;
  hostname: string;
  appVersion: string;
  configPath: string;
  oneDriveEnv: string[];
}

export interface AppConfig {
  archivePath?: string | null;
  lastUserId?: string | null;
}

/** Path helpers that work for both Windows (\) and POSIX (/) paths. */
export const pathUtil = {
  sep(p: string): "\\" | "/" {
    return /^[a-zA-Z]:[\\/]|\\\\/.test(p) || (p.includes("\\") && !p.includes("/")) ? "\\" : "/";
  },
  join(...parts: string[]): string {
    const first = parts[0] ?? "";
    const sep = pathUtil.sep(first);
    const cleaned = parts
      .filter((p) => p !== "")
      .map((p, i) => {
        let s = p.replace(/[\\/]+/g, sep);
        if (i > 0) s = s.replace(/^[\\/]+/, "");
        if (i < parts.length - 1) s = s.replace(/[\\/]+$/, "");
        return s;
      });
    return cleaned.join(sep);
  },
  dirname(p: string): string {
    const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    if (i <= 0) return p.slice(0, i + 1) || p;
    // Keep "C:\" as is
    if (/^[a-zA-Z]:$/.test(p.slice(0, i))) return p.slice(0, i + 1);
    return p.slice(0, i);
  },
  basename(p: string): string {
    const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return p.slice(i + 1);
  },
};

const tauriFs: FileSystem = {
  join: pathUtil.join,
  dirname: pathUtil.dirname,
  basename: pathUtil.basename,
  readFile: async (path) => new Uint8Array(await invoke<ArrayBuffer>("fs_read", { path })),
  readText: (path) => invoke<string>("fs_read_text", { path }),
  writeFile: async (path, data) => {
    await invoke("fs_write", data, { headers: { "x-path": encodeURIComponent(path) } });
  },
  writeText: (path, text) => invoke("fs_write_text", { path, text }),
  createExclusive: (path, text) => invoke<boolean>("fs_create_exclusive", { path, text }),
  exists: (path) => invoke<boolean>("fs_exists", { path }),
  stat: (path) => invoke("fs_stat", { path }),
  mkdirp: (path) => invoke("fs_mkdirp", { path }),
  listDir: (path) => invoke("fs_list", { path }),
  rename: (from, to) => invoke("fs_rename", { from, to }),
  remove: (path, opts) => invoke("fs_remove", { path, recursive: opts?.recursive ?? false }),
  copyFile: (from, to) => invoke("fs_copy", { from, to }),
  sha256File: (path) => invoke<string>("fs_sha256", { path }),
};

const tauriZip: Zipper = {
  zip: (entries, dest) => invoke("zip_create", { entries, dest }),
  unzip: (src, dest) => invoke<string[]>("zip_extract", { src, dest }),
};

class TauriExecutor implements RawExecutor {
  constructor(private readonly handle: number) {}
  select(sql: string, params: SqlValue[]) {
    return invoke<Record<string, unknown>[]>("db_select", { handle: this.handle, sql, params });
  }
  async execute(sql: string, params: SqlValue[]) {
    const n = await invoke<number>("db_execute", { handle: this.handle, sql, params });
    return { rowsAffected: n };
  }
  executeScript(sql: string) {
    return invoke<void>("db_execute_script", { handle: this.handle, sql });
  }
  close() {
    return invoke<void>("db_close", { handle: this.handle });
  }
}

async function openTauriDb(path: string, opts?: { readonly?: boolean }): Promise<ClosableDb> {
  const handle = await invoke<number>("db_open", { path, readonly: opts?.readonly ?? false });
  return new SerializedDb(new TauriExecutor(handle));
}

export async function loadAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("app_info");
}

export function createTauriEnv(info: AppInfo): Env {
  const platform: Platform = {
    pid: async () => info.pid,
    hostname: async () => info.hostname,
    isProcessAlive: (pid) => invoke<boolean>("process_alive", { pid }),
  };
  return {
    fs: tauriFs,
    platform,
    zip: tauriZip,
    openDb: openTauriDb,
    clock: systemClock,
    newId: randomId,
    // Loaded lazily so pdf.js is only fetched when a PDF is imported.
    pdfText: async (bytes) => (await import("../lib/pdf")).pdfText(bytes),
    // Local OCR with bundled Tesseract and Danish data (phase 4.3); loaded on first use.
    ocr: async (bytes, mime) => (await import("../lib/ocr")).ocrText(bytes, mime),
  };
}

export async function readConfig(): Promise<AppConfig> {
  const text = await invoke<string | null>("config_read");
  if (!text) return {};
  try {
    return JSON.parse(text) as AppConfig;
  } catch {
    return {};
  }
}

export async function writeConfig(cfg: AppConfig): Promise<void> {
  await invoke("config_write", { text: JSON.stringify(cfg, null, 2) });
}

export const pickDirectory = (title: string) => invoke<string | null>("pick_directory", { title });

export const pickFiles = (
  title: string,
  opts: { filterName?: string; extensions?: string[]; multiple?: boolean } = {},
) =>
  invoke<string[]>("pick_files", {
    title,
    filterName: opts.filterName ?? null,
    extensions: opts.extensions ?? null,
    multiple: opts.multiple ?? false,
  });

/** The packaged AI connection (spec 06): installed ppm-mcp binary and whether ppm.mcpb can be built. */
export interface McpInfo {
  binaryPath: string | null;
  bundlePath: string | null;
}
export const mcpInfo = () => invoke<McpInfo>("mcp_info");
/** Builds ppm.mcpb from the installed binary and opens it (Claude Desktop installs it). Returns its path. */
export const openMcpBundle = () => invoke<string>("open_mcp_bundle");

export interface ClaudeConfigResult {
  written: string[];
  backups: string[];
  claudeNotFound: boolean;
}
/** Writes PPM into Claude Desktop's claude_desktop_config.json (other entries are kept, a backup is made). */
export const claudeDesktopAdd = () => invoke<ClaudeConfigResult>("claude_desktop_add");
/** Starts ppm-mcp like an MCP client and does initialize + tools/list. */
export const mcpSelftest = () => invoke<{ server: string; tools: number; instructionsChars: number }>("mcp_selftest");
