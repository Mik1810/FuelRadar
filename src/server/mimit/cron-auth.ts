import { createHash, timingSafeEqual } from "node:crypto";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function hasValidCronAuthorization(
  authorization: string | null,
  expectedSecret: string,
): boolean {
  const prefix = "Bearer ";
  if (!authorization?.startsWith(prefix)) return false;

  return timingSafeEqual(
    sha256(authorization.slice(prefix.length)),
    sha256(expectedSecret),
  );
}
