import { prisma } from "@/lib/prisma";

const CACHE_TTL_MS = 60_000;
let cachedMinutes: number | null = null;
let cachedAt = 0;

export async function getIdleTimeoutMinutes(): Promise<number> {
  const now = Date.now();
  if (cachedMinutes !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedMinutes;
  }

  const setting = await prisma.appSetting.findUnique({
    where: { key: "IdleTimeoutMinutes" },
  });
  const parsed = Number.parseInt(setting?.value ?? "5", 10);
  cachedMinutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
  cachedAt = now;
  return cachedMinutes;
}

export function idleTimeoutMs(minutes: number): number {
  return minutes * 60 * 1000;
}
