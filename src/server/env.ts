import "server-only";

import { parseMigrationEnv, parseRuntimeEnv } from "@/config/server-env";

export function getRuntimeEnv() {
  return parseRuntimeEnv(process.env);
}

export function getMigrationEnv() {
  return parseMigrationEnv(process.env);
}
