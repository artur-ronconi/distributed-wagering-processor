import { config } from "./config";

/**
 * Log lines of the app container (pino JSON) that mention `match` (correlationId, messageId…).
 * Returns null when the app does not run under docker compose.
 */
const appLogs = async (match: string, sinceSeconds: number): Promise<unknown[] | null> => {
  try {
    const proc = Bun.spawn(
      ["docker", "compose", "logs", "app", "--no-log-prefix", "--since", `${Math.max(1, Math.ceil(sinceSeconds))}s`],
      { cwd: config.repoRoot, stdout: "pipe", stderr: "ignore" },
    );
    const timer = setTimeout(() => proc.kill(), 5_000);
    const text = await new Response(proc.stdout).text();
    clearTimeout(timer);
    if ((await proc.exited) !== 0 && text.length === 0) return null;

    return text
      .split("\n")
      .filter((line) => line.includes(match))
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return line;
        }
      });
  } catch {
    return null;
  }
};

export { appLogs };
