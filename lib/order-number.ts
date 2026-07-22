import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const MAX_ORDER_NUMBER_ATTEMPTS = 50;

type OrderNumberStore = Pick<Prisma.TransactionClient, "order">;

export async function generateOrderNumber(
  store: OrderNumberStore = prisma,
): Promise<string> {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const utcStart = new Date(date);
  const utcEnd = new Date(date);
  utcEnd.setDate(utcEnd.getDate() + 1);

  const day = String(date.getDate()).padStart(2, "0");
  let counter =
    10 +
    (await store.order.count({
      where: { createdAt: { gte: utcStart, lt: utcEnd } },
    }));

  let candidate = `O-${day}${counter}`;
  while (await store.order.findFirst({ where: { orderNumber: candidate } })) {
    counter += 1;
    candidate = `O-${day}${counter}`;
  }
  return candidate;
}

export function isOrderNumberUniqueViolation(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.some(
      (field) =>
        String(field) === "order_number" || String(field) === "orderNumber",
    );
  }

  const targetText = String(target ?? "");
  return targetText.includes("order_number") || targetText.includes("orderNumber");
}

/** Mirrors RPOS collision safety: retry with a fresh sequence on unique violations. */
export async function createOrderWithUniqueNumber<T>(
  create: (orderNumber: string) => Promise<T>,
  store: OrderNumberStore = prisma,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_ORDER_NUMBER_ATTEMPTS; attempt += 1) {
    const orderNumber = await generateOrderNumber(store);
    try {
      return await create(orderNumber);
    } catch (error) {
      if (!isOrderNumberUniqueViolation(error)) {
        throw error;
      }
    }
  }

  throw new Error("Failed to allocate a unique order number after retries");
}
