export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code = "SERVICE_ERROR",
    public readonly status = 400,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function getServiceErrorMessage(
  error: unknown,
  fallback = "Operation failed",
): string {
  return error instanceof Error ? error.message : fallback;
}
