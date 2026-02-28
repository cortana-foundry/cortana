import { execSync } from "child_process";
import { PSQL_BIN } from "./paths.js";

function run(sql: string): string {
  try {
    const escaped = sql.replace(/"/g, '\\"');
    return execSync(`${PSQL_BIN} cortana -v ON_ERROR_STOP=1 -X -q -t -A -c "${escaped}"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `/opt/homebrew/opt/postgresql@17/bin:${process.env.PATH ?? ""}`,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[db] SQL execution failed: ${msg}`);
    console.error(`[db] SQL: ${sql}`);
    throw new Error(`Database query failed: ${msg}`);
  }
}

export function query(sql: string): string {
  return run(sql);
}

export function queryJson(sql: string): any[] {
  const raw = run(sql).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[db] Failed to parse JSON response: ${msg}`);
    throw new Error(`Database JSON parse failed: ${msg}`);
  }
}

export function execute(sql: string): void {
  void run(sql);
}
