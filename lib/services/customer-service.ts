import { ServiceError } from "@/lib/api/service-error";
import { prisma } from "@/lib/prisma";
import { formatPKR } from "@/lib/currency";
import { enqueueSync } from "@/lib/sync-queue";
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
} from "@/lib/validators/customer.validators";

export async function getCustomerSummary() {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [totalCustomers, revenueAgg, premiumCount, newThisMonth, totalOrders] =
    await Promise.all([
      prisma.customer.count({ where: { isActive: true } }),
      prisma.customer.aggregate({
        where: { isActive: true },
        _sum: { totalSpent: true },
      }),
      prisma.customer.count({
        where: { isActive: true, tier: { in: ["Gold", "Platinum"] } },
      }),
      prisma.customer.count({
        where: { isActive: true, createdAt: { gte: monthStart } },
      }),
      prisma.order.count({
        where: {
          isActive: true,
          customerId: { not: null },
          status: { in: ["Closed", "Delivered"] },
        },
      }),
    ]);

  const totalRevenue = revenueAgg._sum.totalSpent ?? 0n;
  return {
    totalCustomers,
    totalRevenue,
    totalRevenueFormatted: formatPKR(totalRevenue),
    totalOrders,
    premiumCount,
    newThisMonth,
  };
}

export async function listCustomers(params: {
  page: number;
  limit: number;
  phone?: string;
  q?: string;
}) {
  const where = params.phone
    ? { phone: params.phone, isActive: true }
    : params.q
      ? {
          isActive: true,
          OR: [
            { name: { contains: params.q } },
            { phone: { contains: params.q } },
            { email: { contains: params.q } },
          ],
        }
      : { isActive: true };

  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
    prisma.customer.count({ where }),
  ]);

  return { items, total, page: params.page, limit: params.limit };
}

const CUSTOMER_HISTORY_LIMIT = 50;

export async function getCustomerById(id: number) {
  return prisma.customer.findUnique({
    where: { id },
    include: {
      addresses: { where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { id: "asc" }] },
      loyaltyTransactions: {
        orderBy: { createdAt: "desc" },
        take: CUSTOMER_HISTORY_LIMIT,
      },
      orders: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        take: CUSTOMER_HISTORY_LIMIT,
        include: {
          payments: { include: { paymentMethod: true } },
          orderItems: { include: { product: { select: { id: true, name: true, sku: true } } } },
        },
      },
    },
  });
}

export async function getCustomerByPhone(phone: string) {
  return prisma.customer.findFirst({
    where: { phone, isActive: true },
    include: {
      loyaltyTransactions: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
}

export async function listCustomerAddresses(customerId: number) {
  return prisma.customerAddress.findMany({
    where: { customerId, isActive: true },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
  });
}

export async function updateCustomerAddress(
  customerId: number,
  addressId: number,
  input: {
    label?: string;
    addressLine1?: string;
    addressLine2?: string | null;
    city?: string | null;
    area?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    isDefault?: boolean;
  },
) {
  const existing = await prisma.customerAddress.findFirst({
    where: { id: addressId, customerId, isActive: true },
  });
  if (!existing) throw new ServiceError("Address not found", "ADDRESS_NOT_FOUND");

  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.customerAddress.updateMany({
        where: { customerId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.customerAddress.update({
      where: { id: addressId },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.addressLine1 !== undefined
          ? { addressLine1: input.addressLine1 }
          : {}),
        ...(input.addressLine2 !== undefined
          ? { addressLine2: input.addressLine2 }
          : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.area !== undefined ? { area: input.area } : {}),
        ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      },
    });
  });
}

export async function deleteCustomerAddress(
  customerId: number,
  addressId: number,
) {
  const existing = await prisma.customerAddress.findFirst({
    where: { id: addressId, customerId, isActive: true },
  });
  if (!existing) throw new ServiceError("Address not found", "ADDRESS_NOT_FOUND");

  return prisma.$transaction(async (tx) => {
    await tx.customerAddress.update({
      where: { id: addressId },
      data: { isActive: false, isDefault: false },
    });

    if (existing.isDefault) {
      const next = await tx.customerAddress.findFirst({
        where: { customerId, isActive: true, id: { not: addressId } },
        orderBy: { id: "asc" },
      });
      if (next) {
        await tx.customerAddress.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }

    return { deleted: true, addressId };
  });
}

export async function addCustomerAddress(input: {
  customerId: number;
  label: string;
  addressLine1: string;
  addressLine2?: string | null;
  city?: string | null;
  area?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isDefault?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.customerAddress.updateMany({
        where: { customerId: input.customerId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.customerAddress.create({
      data: {
        customerId: input.customerId,
        label: input.label,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? null,
        city: input.city ?? null,
        area: input.area ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        isDefault: input.isDefault ?? false,
      },
    });
  });
}

export async function expireLoyaltyPoints(input: {
  customerId?: number;
  pointsToExpire?: bigint;
}) {
  const customers = input.customerId
    ? await prisma.customer.findMany({
        where: {
          id: input.customerId,
          isActive: true,
          loyaltyPoints: { gt: 0n },
        },
      })
    : await prisma.customer.findMany({
        where: { isActive: true, loyaltyPoints: { gt: 0n } },
      });

  if (input.customerId && customers.length === 0) {
    const exists = await prisma.customer.findFirst({
      where: { id: input.customerId, isActive: true },
      select: { id: true, loyaltyPoints: true },
    });
    if (!exists) {
      throw new ServiceError("Customer not found", "CUSTOMER_NOT_FOUND", 404);
    }
    if (exists.loyaltyPoints <= 0n) {
      throw new ServiceError(
        "Customer has no loyalty points to expire",
        "NO_POINTS_TO_EXPIRE",
        400,
      );
    }
  }

  const results: Array<{
    customerId: number;
    expiredPoints: bigint;
    remainingPoints: bigint;
  }> = [];

  for (const customer of customers) {
    const expiredPoints =
      input.pointsToExpire !== undefined
        ? input.pointsToExpire > customer.loyaltyPoints
          ? customer.loyaltyPoints
          : input.pointsToExpire
        : customer.loyaltyPoints;

    if (expiredPoints <= 0n) {
      continue;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const nextCustomer = await tx.customer.update({
        where: { id: customer.id },
        data: { loyaltyPoints: { decrement: expiredPoints } },
      });
      await tx.loyaltyTransaction.create({
        data: {
          customerId: customer.id,
          type: "Expire",
          points: expiredPoints,
          description: "Points expired",
        },
      });
      return nextCustomer;
    });

    results.push({
      customerId: customer.id,
      expiredPoints,
      remainingPoints: updated.loyaltyPoints,
    });
  }

  return results;
}

export async function adjustLoyaltyPoints(input: {
  customerId: number;
  points: bigint;
  description?: string | null;
  type?: "Adjust" | "Expire";
}) {
  const transactionType = input.type ?? "Adjust";
  const pointsDelta =
    transactionType === "Expire" ? -input.points : input.points;

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.update({
      where: { id: input.customerId },
      data: { loyaltyPoints: { increment: pointsDelta } },
    });
    await tx.loyaltyTransaction.create({
      data: {
        customerId: input.customerId,
        type: transactionType,
        points: input.points,
        description:
          input.description ??
          (transactionType === "Expire" ? "Points expired" : "Manual adjustment"),
      },
    });
    return customer;
  });
}

export async function createCustomer(input: CreateCustomerInput) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.create({ data: input });
    await enqueueSync(
      {
        tableName: "customers",
        recordId: customer.id,
        operation: "CREATE",
        payload: { id: customer.id, name: customer.name, phone: customer.phone },
      },
      tx,
    );
    return customer;
  });
}

export async function updateCustomer(id: number, input: UpdateCustomerInput) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.update({ where: { id }, data: input });
    await enqueueSync(
      {
        tableName: "customers",
        recordId: id,
        operation: "UPDATE",
        payload: { id, ...input },
      },
      tx,
    );
    return customer;
  });
}

export async function softDeleteCustomer(id: number) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.update({
      where: { id },
      data: { isActive: false },
    });
    await enqueueSync(
      {
        tableName: "customers",
        recordId: id,
        operation: "DELETE",
        payload: { id, isActive: false },
      },
      tx,
    );
    return customer;
  });
}
