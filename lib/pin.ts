import { createHash } from "node:crypto";

/** SHA-256 lowercase hex — matches RPOS AuthService.HashPin / seed.ts */
export function hashPin(pin: string): string {
  return createHash("sha256").update(pin).digest("hex");
}
