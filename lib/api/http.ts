import { NextResponse } from "next/server";

/** JSON.stringify replacer — BigInt → string for safe API responses */
export function serializeJson(data: unknown): string {
  return JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

export function jsonOk<T>(data: T, status = 200) {
  return new NextResponse(serializeJson({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function jsonError(message: string, status = 400, details?: unknown) {
  return new NextResponse(
    serializeJson({ success: false, error: message, details }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
