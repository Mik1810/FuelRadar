import { z } from "zod";

const postgresUrl = z.string().url().superRefine((value, context) => {
  const protocol = new URL(value).protocol;
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    context.addIssue({
      code: "custom",
      message: "must use the postgres or postgresql protocol",
    });
  }
});

const runtimeEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
  MIMIT_RETENTION_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

const cronEnvSchema = z.object({
  CRON_SECRET: z.string().min(32),
});

const migrationEnvSchema = z.object({
  MIGRATION_DATABASE_URL: postgresUrl,
});

function parseEnvironment<T>(
  schema: z.ZodType<T>,
  input: unknown,
  label: string,
): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const details = result.error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid ${label} environment: ${details}`);
}

export function parseRuntimeEnv(input: unknown): z.infer<typeof runtimeEnvSchema> {
  return parseEnvironment(runtimeEnvSchema, input, "runtime");
}

export function parseMigrationEnv(
  input: unknown,
): z.infer<typeof migrationEnvSchema> {
  return parseEnvironment(migrationEnvSchema, input, "migration");
}

export function parseCronEnv(input: unknown): z.infer<typeof cronEnvSchema> {
  return parseEnvironment(cronEnvSchema, input, "cron");
}
