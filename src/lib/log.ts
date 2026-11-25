type Level = "info" | "warn" | "error";

function write(level: Level, msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** One JSON line per event, so hosting logs stay searchable. */
export const log = {
  info: (msg: string, extra?: Record<string, unknown>) => write("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => write("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => write("error", msg, extra),
};
