import { relative, resolve } from "node:path";

import { config } from "./config";

/** Serves backend source files (read only, only under src/) so each step can show its real code. */
const readSource = async (file: string): Promise<string | null> => {
  const absolute = resolve(config.repoRoot, file);
  const inside = relative(resolve(config.repoRoot, "src"), absolute);
  if (inside.startsWith("..") || !absolute.endsWith(".ts")) return null;

  const handle = Bun.file(absolute);
  return (await handle.exists()) ? handle.text() : null;
};

export { readSource };
