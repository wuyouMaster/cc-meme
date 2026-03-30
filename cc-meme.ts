/**
 * cc-meme — Claude Code hook script
 *
 * Claude Code hooks are short-lived per-event processes (unlike OpenCode plugins
 * which are long-running). IPC with the overlay is done via a POSIX named pipe
 * (FIFO) so the overlay process can persist across multiple hook calls.
 *
 * Event mapping (Claude Code → opencode-plugin equivalent):
 *   SessionStart        → session.created   (show overlay, "Starting...")
 *   UserPromptSubmit    → (no equivalent)   (show overlay, prompt preview)
 *   PreToolUse          → tool.execute.before (show tool name)
 *   PostToolUse         → tool.execute.after  (show "Done")
 *   PostToolUseFailure  → session.error       (show error)
 *   Stop                → session.idle        (show "Done")
 *   StopFailure         → session.error       (show error)
 *   Notification        → (no equivalent)    (idle / permission prompts)
 *
 * Configure in ~/.claude/settings.json — see hooks.json for the full config.
 */

import { execSync, spawn } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

// ---- Configuration (shared with opencode-plugin) ----

function getConfigDir(): string {
  return resolve(homedir(), ".config", "meme-overlay");
}

function getOverlayPath(): string {
  if (process.env.OVERLAY_BIN && existsSync(process.env.OVERLAY_BIN)) {
    return process.env.OVERLAY_BIN;
  }
  const ext = process.platform === "win32" ? ".exe" : "";
  const dir = getConfigDir();
  const candidates = [
    resolve(dir, `bin/meme-overlay${ext}`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    `[cc-meme] Overlay binary not found.\n` +
      `Searched:\n${candidates.map((c) => `  - ${c}`).join("\n")}\n\n` +
      `Download from https://github.com/your-org/opencode-overlay/releases\n` +
      `and place it at ${candidates[0]}`
  );
}

interface HookAssignment {
  animation?: string;
  custom_text?: string;
}

interface ClientConfig {
  hook_assignments?: Record<string, HookAssignment>;
  assignments?: Record<string, string>;
}

interface Config {
  cc?: ClientConfig;
  // legacy flat format
  hook_assignments?: Record<string, HookAssignment>;
  assignments?: Record<string, string>;
}

function loadConfig(): ClientConfig {
  const configPath = resolve(getConfigDir(), "config.json");
  try {
    const raw: Config = JSON.parse(readFileSync(configPath, "utf-8"));
    // New format: config.cc
    if (raw.cc) return raw.cc;
    // Legacy flat format fallback
    return { hook_assignments: raw.hook_assignments, assignments: raw.assignments };
  } catch {
    return {};
  }
}

function getAnimationForHook(hookId: string): { name: string | null; text: string } {
  const config = loadConfig();

  if (config.hook_assignments?.[hookId]) {
    const a = config.hook_assignments[hookId];
    return { name: a.animation ?? null, text: a.custom_text ?? "" };
  }

  // Legacy phase map (shared with opencode-plugin "assignments" format)
  const phaseMap: Record<string, string> = {
    "cc.session.start":  "thinking",
    "cc.user.prompt":    "thinking",
    "cc.tool.before":    "coding",
    "cc.tool.after":     "coding",
    "cc.tool.failure":   "error",
    "cc.stop":           "success",
    "cc.stop.failure":   "error",
    "cc.notification":   "thinking",
  };
  const phase = phaseMap[hookId];
  if (phase && config.assignments?.[phase]) {
    return { name: config.assignments[phase], text: "" };
  }

  return { name: null, text: "" };
}

// ---- Default display texts ----

const HOOK_DEFAULT_TEXTS: Record<string, string> = {
  "cc.session.start":  "Starting...",
  "cc.user.prompt":    "Processing...",
  "cc.tool.before":    "Executing...",
  "cc.tool.after":     "Done",
  "cc.tool.failure":   "Error",
  "cc.stop":           "Done",
  "cc.stop.failure":   "Error",
  "cc.notification":   "Notification",
};

// ---- FIFO-based IPC (macOS / Linux) ----
// Each hook invocation is a new process. The overlay persists via a named pipe:
// - The overlay process holds the read end of the pipe open as its stdin.
// - Each hook call opens the pipe in O_RDWR (non-blocking) to write commands.
// - Because O_RDWR acts as both reader and writer, the open() call never blocks.

const PIPE_PATH = resolve(getConfigDir(), "overlay.pipe");
const PID_FILE  = resolve(getConfigDir(), "overlay.pid");

function ensureFifo(): void {
  if (!existsSync(PIPE_PATH)) {
    execSync(`mkfifo "${PIPE_PATH}"`);
  }
}

function sendToOverlay(cmds: object[]): void {
  if (process.platform === "win32" || !existsSync(PIPE_PATH)) return;
  try {
    const fd = openSync(
      PIPE_PATH,
      fsConstants.O_RDWR | fsConstants.O_NONBLOCK
    );
    for (const cmd of cmds) {
      writeSync(fd, JSON.stringify(cmd) + "\n");
    }
    closeSync(fd);
  } catch {
    // Overlay may have exited; silently ignore
  }
}

// ---- Overlay process lifecycle ----

function isOverlayAlive(): boolean {
  try {
    if (!existsSync(PID_FILE)) return false;
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    process.kill(pid, 0); // throws if process doesn't exist
    return true;
  } catch {
    return false;
  }
}

function killOverlay(): void {
  try {
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
      process.kill(pid, "SIGTERM");
    }
  } catch {}
  try { unlinkSync(PID_FILE); } catch {}
  try { unlinkSync(PIPE_PATH); } catch {}
}

function startOverlay(): boolean {
  if (process.platform === "win32") return false;

  let binPath: string;
  try {
    binPath = getOverlayPath();
  } catch (e) {
    console.error((e as Error).message);
    return false;
  }

  mkdirSync(getConfigDir(), { recursive: true });
  ensureFifo();

  // Open FIFO in O_RDWR so spawn doesn't block waiting for a reader
  const pipeFd = openSync(
    PIPE_PATH,
    fsConstants.O_RDWR | fsConstants.O_NONBLOCK
  );

  const child = spawn(binPath, [], {
    stdio: [pipeFd, "ignore", "ignore"],
    detached: true,
  });
  child.unref();

  if (child.pid) {
    writeFileSync(PID_FILE, String(child.pid));
  }
  closeSync(pipeFd);

  // Give the overlay time to open its stdin before we start writing
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  return true;
}

function ensureOverlay(): boolean {
  if (isOverlayAlive()) return true;
  return startOverlay();
}

// ---- Show helpers (mirroring opencode-plugin's showForHook) ----

function buildShowCmds(hookId: string, labelOverride?: string): object[] {
  const { name: animName, text: customText } = getAnimationForHook(hookId);
  const text = labelOverride || customText || HOOK_DEFAULT_TEXTS[hookId] || "";
  const cmds: object[] = [];
  if (animName) cmds.push({ type: "animation", name: animName });
  cmds.push({ type: "progress", text });
  cmds.push({ type: "show" });
  return cmds;
}

// ---- Claude Code hook input types ----

interface CommonInput {
  hook_event_name: string;
  session_id: string;
  cwd: string;
}

interface SessionStartInput extends CommonInput {
  source: "startup" | "resume" | "clear" | "compact";
  model: string;
}

interface UserPromptSubmitInput extends CommonInput {
  prompt: string;
}

interface PreToolUseInput extends CommonInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

interface PostToolUseInput extends CommonInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: unknown;
  tool_use_id: string;
}

interface PostToolUseFailureInput extends CommonInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  error: string;
  is_interrupt?: boolean;
}

interface StopInput extends CommonInput {
  stop_hook_active: boolean;
  last_assistant_message: string;
}

interface StopFailureInput extends CommonInput {
  error: "rate_limit" | "authentication_failed" | "billing_error" | "invalid_request" | "server_error" | "max_output_tokens" | "unknown";
  error_details?: string;
  last_assistant_message?: string;
}

interface NotificationInput extends CommonInput {
  message: string;
  title?: string;
  notification_type: "permission_prompt" | "idle_prompt" | "auth_success" | "elicitation_dialog";
}

interface SessionEndInput extends CommonInput {
  reason: "clear" | "resume" | "logout" | "prompt_input_exit" | "bypass_permissions_disabled" | "other";
}

async function readStdin(): Promise<CommonInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  return raw ? (JSON.parse(raw) as CommonInput) : { hook_event_name: "", session_id: "", cwd: "" };
}

// ---- Main ----

async function main(): Promise<void> {
  const event = await readStdin();

  switch (event.hook_event_name) {
    // Session starts (fresh or resumed) → show overlay
    case "SessionStart": {
      const e = event as SessionStartInput;
      if (e.source === "compact") break; // compaction is not a user-visible session change
      if (e.source === "startup") {
        // Fresh session: restart overlay to ensure clean state
        killOverlay();
        startOverlay();
      } else {
        // resume / clear: keep existing overlay or start a fresh one
        ensureOverlay();
      }
      sendToOverlay(buildShowCmds("cc.session.start"));
      break;
    }

    // User submitted a prompt → switch to "processing" state
    case "UserPromptSubmit": {
      const e = event as UserPromptSubmitInput;
      if (!ensureOverlay()) break;
      // Show first 60 chars of the prompt as progress text
      const preview = e.prompt.slice(0, 60).replace(/\n/g, " ");
      sendToOverlay(buildShowCmds("cc.user.prompt", preview || undefined));
      break;
    }

    // Claude is about to call a tool → show tool name
    case "PreToolUse": {
      const e = event as PreToolUseInput;
      if (!ensureOverlay()) break;
      sendToOverlay(buildShowCmds("cc.tool.before", e.tool_name));
      break;
    }

    // Tool succeeded → show brief "Done" feedback
    case "PostToolUse": {
      const e = event as PostToolUseInput;
      if (!isOverlayAlive()) break;
      sendToOverlay(buildShowCmds("cc.tool.after", e.tool_name));
      break;
    }

    // Tool failed → show error with tool name
    case "PostToolUseFailure": {
      const e = event as PostToolUseFailureInput;
      if (!isOverlayAlive()) break;
      sendToOverlay(buildShowCmds("cc.tool.failure", e.tool_name));
      break;
    }

    // Claude finished responding → idle / "Done" state
    case "Stop": {
      const _e = event as StopInput;
      if (!isOverlayAlive()) break;
      sendToOverlay(buildShowCmds("cc.stop"));
      break;
    }

    // Turn ended due to API error → show error state
    case "StopFailure": {
      const _e = event as StopFailureInput;
      if (!isOverlayAlive()) break;
      sendToOverlay(buildShowCmds("cc.stop.failure"));
      break;
    }

    // Claude Code is sending a notification to the user
    case "Notification": {
      const e = event as NotificationInput;
      if (!isOverlayAlive()) break;
      if (e.notification_type === "idle_prompt") {
        sendToOverlay(buildShowCmds("cc.notification", "Waiting for input..."));
      } else if (e.notification_type === "permission_prompt") {
        sendToOverlay(buildShowCmds("cc.notification", "Permission needed"));
      }
      break;
    }

    // Session is ending (e.g. /exit, /clear, logout) → kill overlay
    case "SessionEnd": {
      const e = event as SessionEndInput;
      // On /clear or /resume the session restarts immediately — keep overlay alive
      if (e.reason === "clear" || e.reason === "resume") break;
      killOverlay();
      break;
    }
  }
}

main().catch((err) => {
  // Never block Claude Code on hook errors
  console.error("[cc-meme]", (err as Error).message);
  process.exit(0);
});
