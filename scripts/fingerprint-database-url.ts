import { parseCronEnv, parseRuntimeEnv } from "../src/config/server-env";
import { fingerprintDatabaseUrl } from "../src/server/mimit/cron-auth";

const { DATABASE_URL } = parseRuntimeEnv(process.env);
const { CRON_SECRET } = parseCronEnv(process.env);

console.log(fingerprintDatabaseUrl(DATABASE_URL, CRON_SECRET));
