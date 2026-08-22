/**
 * Worker logging.
 *
 * Plain lines, not JSON: the operator reads this in a terminal or in a hosting
 * dashboard's log tail, and a distribution that credited twelve nodes should be
 * one readable line. Fields are appended as key=value so grep still works.
 */

export type LogLevel = "info" | "warn" | "error";

function line(level: LogLevel, message: string, fields?: Record<string, unknown>): string {
  const parts = [new Date().toISOString(), level.padEnd(5), message];
  if (fields) {
    const rendered = Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${typeof v === "string" && v.includes(" ") ? JSON.stringify(v) : String(v)}`);
    if (rendered.length > 0) parts.push(rendered.join(" "));
  }
  return parts.join("  ");
}

export const log = {
  info(message: string, fields?: Record<string, unknown>): void {
    console.log(line("info", message, fields));
  },
  warn(message: string, fields?: Record<string, unknown>): void {
    console.warn(line("warn", message, fields));
  },
  error(message: string, fields?: Record<string, unknown>): void {
    console.error(line("error", message, fields));
  },
};

/** Message of anything thrown, without the stack, for a log field or an alert. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0];
  return String(err);
}
