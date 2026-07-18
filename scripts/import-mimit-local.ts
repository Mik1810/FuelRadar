import { getLocalDatabaseUrl } from "./local-database";

process.env.DATABASE_URL = getLocalDatabaseUrl();

await import("./import-mimit");
