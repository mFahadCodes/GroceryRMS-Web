type ApiSuccess<T> = { success: true; data: T };
type ApiFailure = { success: false; error: string; details?: unknown };
type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function parseErrorMessage(json: unknown, status: number): string {
  if (
    json &&
    typeof json === "object" &&
    "error" in json &&
    typeof (json as ApiFailure).error === "string"
  ) {
    return (json as ApiFailure).error;
  }
  return `Request failed (${status})`;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    if (!res.ok) {
      throw new ApiError(
        res.statusText || `Request failed (${res.status})`,
        res.status,
      );
    }
    throw new ApiError("Invalid response from server", res.status);
  }

  const body = json as ApiResponse<T>;

  if (!res.ok || !body.success) {
    throw new ApiError(
      parseErrorMessage(json, res.status),
      res.status,
      "details" in body ? body.details : undefined,
    );
  }

  return body.data;
}
