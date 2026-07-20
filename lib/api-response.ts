import { NextResponse } from "next/server";
import { serializeJson } from "@/lib/api/http";

type ApiFailure = {
  success: false;
  error: string;
  code: string;
  details?: unknown;
};

export function ok<T>(data: T, status = 200) {
  return new NextResponse(serializeJson({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function fail(
  message: string,
  code: string,
  status = 400,
  details?: unknown,
) {
  const payload: ApiFailure = { success: false, error: message, code };
  if (details !== undefined) {
    payload.details = details;
  }

  return new NextResponse(serializeJson(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
  status = 200,
) {
  return ok(
    {
      items,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    },
    status,
  );
}
