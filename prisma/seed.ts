/**
 * GroceryRMS database seed
 * Source: GroceryRMS-spec.md §3 seed data + PosDbContext.cs RBAC matrix
 *
 * The first administrator is bootstrapped from explicit environment variables.
 * Existing administrator accounts and credentials are preserved on reseed.
 */

import { config } from "dotenv";

config({ path: ".env.local", override: true });
config({ override: true });

import bcrypt from "bcryptjs";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { resolveDatabaseUrl } from "../lib/database-url";
import { hashPin } from "../lib/pin";
import { bootstrapAdministrator } from "./seed/bootstrap-admin";

/**
 * Retail permission matrix (24 entries). RPOS restaurant IDs 11 (Manage tables &
 * sessions) and 18 (View kitchen orders) are intentionally omitted.
 */
const permissions: Array<{
  id: number;
  name: string;
  module: string;
  description: string;
}> = [
  { id: 1, name: "Login / authentication", module: "General", description: "Login and authenticate" },
  { id: 2, name: "View own profile", module: "General", description: "View/edit own profile" },
  { id: 3, name: "Manage users & roles", module: "General", description: "Create/edit users and roles" },
  { id: 4, name: "View audit log", module: "General", description: "View system audit trail" },
  { id: 5, name: "Create & process orders", module: "Sales", description: "Create and process orders" },
  { id: 6, name: "Apply discounts", module: "Sales", description: "Apply discounts to orders" },
  { id: 7, name: "Void / cancel orders", module: "Sales", description: "Void or cancel orders" },
  { id: 8, name: "Hold & recall orders", module: "Sales", description: "Hold and recall orders" },
  { id: 9, name: "Process payments", module: "Sales", description: "Process order payments" },
  { id: 10, name: "Issue refunds", module: "Sales", description: "Issue refunds on orders" },
  { id: 12, name: "Manage customers & loyalty", module: "Sales", description: "Manage customers and loyalty" },
  { id: 13, name: "Open / close shift", module: "Sales", description: "Open and close shifts" },
  { id: 14, name: "Cash drawer operations", module: "Sales", description: "Cash drawer open/close" },
  { id: 15, name: "View catalog", module: "Inventory", description: "View products and categories" },
  { id: 16, name: "Manage products", module: "Inventory", description: "Add/edit/delete products" },
  { id: 17, name: "Manage inventory", module: "Inventory", description: "Manage stock and purchase orders" },
  { id: 19, name: "Manage employees", module: "HR & Finance", description: "Manage employee records" },
  { id: 20, name: "Manage suppliers", module: "HR & Finance", description: "Manage supplier records" },
  { id: 21, name: "Manage expenses", module: "HR & Finance", description: "Manage expenses" },
  { id: 22, name: "Generate payroll", module: "HR & Finance", description: "Generate payroll" },
  { id: 23, name: "View reports & analytics", module: "Config", description: "Access reports and analytics" },
  { id: 24, name: "Manage tax & discounts", module: "Config", description: "Manage tax rates and discounts" },
  { id: 25, name: "Manage printers & terminals", module: "Config", description: "Manage printers and terminals" },
  { id: 26, name: "System app settings", module: "Config", description: "System application settings" },
];

/** Admin: all retail permissions at level 5 */
const adminRolePermissions = permissions.map((p) => ({
  permissionId: p.id,
  accessLevel: 5,
}));

/**
 * Manager: 22 permissions (original PosDbContext matrix)
 * Missing: 3 Manage users, 10 Issue refunds, 22 Generate payroll, 24 Manage tax, 25 Manage printers, 26 System settings
 */
const managerRolePermissions: Array<{ permissionId: number; accessLevel: number }> = [
  { permissionId: 1, accessLevel: 5 },
  { permissionId: 2, accessLevel: 5 },
  { permissionId: 4, accessLevel: 4 },
  { permissionId: 5, accessLevel: 5 },
  { permissionId: 6, accessLevel: 5 },
  { permissionId: 7, accessLevel: 5 },
  { permissionId: 8, accessLevel: 5 },
  { permissionId: 9, accessLevel: 5 },
  { permissionId: 10, accessLevel: 5 },
  { permissionId: 12, accessLevel: 5 },
  { permissionId: 13, accessLevel: 5 },
  { permissionId: 14, accessLevel: 5 },
  { permissionId: 15, accessLevel: 5 },
  { permissionId: 16, accessLevel: 5 },
  { permissionId: 17, accessLevel: 5 },
  { permissionId: 19, accessLevel: 4 },
  { permissionId: 20, accessLevel: 4 },
  { permissionId: 21, accessLevel: 4 },
  { permissionId: 23, accessLevel: 5 },
];

/** Cashier: restricted discount/customers (level 2) */
const cashierRolePermissions: Array<{ permissionId: number; accessLevel: number }> = [
  { permissionId: 1, accessLevel: 5 },
  { permissionId: 2, accessLevel: 5 },
  { permissionId: 5, accessLevel: 5 },
  { permissionId: 6, accessLevel: 2 },
  { permissionId: 8, accessLevel: 5 },
  { permissionId: 9, accessLevel: 5 },
  { permissionId: 12, accessLevel: 2 },
  { permissionId: 13, accessLevel: 5 },
  { permissionId: 14, accessLevel: 5 },
  { permissionId: 15, accessLevel: 5 },
];

const paymentMethods = [
  { id: 1, name: "Cash", code: "CASH", isDigital: false },
  { id: 2, name: "Card", code: "CARD", isDigital: false },
  { id: 3, name: "JazzCash", code: "JAZZCASH", isDigital: true },
  { id: 4, name: "EasyPaisa", code: "EASYPAISA", isDigital: true },
  { id: 5, name: "NayaPay", code: "NAYAPAY", isDigital: true },
];

const taxRates = [
  {
    id: 1,
    name: "Standard Retail Tax (16% Inclusive)",
    rate: new Prisma.Decimal(16),
    isInclusive: true,
  },
  {
    id: 2,
    name: "Zero-Rated (0%)",
    rate: new Prisma.Decimal(0),
    isInclusive: false,
  },
  {
    id: 3,
    name: "Exempt (0%)",
    rate: new Prisma.Decimal(0),
    isInclusive: false,
  },
];

const appSettings: Array<{
  id: number;
  key: string;
  value: string;
  dataType: string;
  group: string;
  description?: string;
}> = [
  { id: 1, key: "StoreName", value: "My Store", dataType: "string", group: "General" },
  { id: 2, key: "Currency", value: "PKR", dataType: "string", group: "General" },
  { id: 3, key: "CurrencySymbol", value: "Rs.", dataType: "string", group: "General" },
  { id: 4, key: "IdleTimeoutMinutes", value: "5", dataType: "int", group: "Security" },
  { id: 5, key: "DefaultTaxRateId", value: "1", dataType: "int", group: "Tax" },
  { id: 6, key: "ServiceChargePercent", value: "0", dataType: "decimal", group: "Billing" },
  { id: 7, key: "LoyaltyPointsPerPKR", value: "1", dataType: "int", group: "Loyalty" },
  {
    id: 8,
    key: "LoyaltyRedeemRate",
    value: "100",
    dataType: "int",
    group: "Loyalty",
    description: "Points needed for 1 PKR discount",
  },
  {
    id: 9,
    key: "ReceiptHeader",
    value: "Thank you for shopping with us!",
    dataType: "string",
    group: "Printing",
  },
  { id: 10, key: "ReceiptFooter", value: "Visit us again!", dataType: "string", group: "Printing" },
  { id: 11, key: "SyncEnabled", value: "false", dataType: "bool", group: "Sync" },
  { id: 12, key: "SyncServerUrl", value: "", dataType: "string", group: "Sync" },
  { id: 13, key: "SyncIntervalSeconds", value: "300", dataType: "int", group: "Sync" },
  { id: 14, key: "AutoPrintReceipt", value: "true", dataType: "bool", group: "Printing" },
  {
    id: 15,
    key: "ReceiptStoreName",
    value: "",
    dataType: "string",
    group: "Printing",
    description: "Receipt header name override; falls back to StoreName when empty",
  },
  { id: 16, key: "StoreAddress", value: "Main Market Road", dataType: "string", group: "General" },
  { id: 17, key: "StorePhone", value: "+92-300-0000000", dataType: "string", group: "General" },
  { id: 18, key: "AutoBackupEnabled", value: "false", dataType: "bool", group: "Backup" },
  { id: 19, key: "AutoBackupIntervalHours", value: "24", dataType: "int", group: "Backup" },
  { id: 20, key: "LastBackupAt", value: "", dataType: "string", group: "Backup" },
  { id: 21, key: "ShowCustomerOnReceipt", value: "true", dataType: "bool", group: "Receipt" },
  { id: 22, key: "ShowCashierOnReceipt", value: "true", dataType: "bool", group: "Receipt" },
  { id: 23, key: "ShowOrderTypeOnReceipt", value: "true", dataType: "bool", group: "Receipt" },
  { id: 24, key: "ShowTaxBreakdownOnReceipt", value: "true", dataType: "bool", group: "Receipt" },
  {
    id: 25,
    key: "TierSilverThreshold",
    value: "2000000",
    dataType: "int",
    group: "Loyalty",
    description: "Minimum lifetime spend (paisa) for Silver tier",
  },
  {
    id: 26,
    key: "TierGoldThreshold",
    value: "5000000",
    dataType: "int",
    group: "Loyalty",
    description: "Minimum lifetime spend (paisa) for Gold tier",
  },
  {
    id: 27,
    key: "TierPlatinumThreshold",
    value: "10000000",
    dataType: "int",
    group: "Loyalty",
    description: "Minimum lifetime spend (paisa) for Platinum tier",
  },
];

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaBetterSqlite3({
    url: resolveDatabaseUrl(databaseUrl),
  });
  return new PrismaClient({ adapter });
}

async function seedRoles(prisma: PrismaClient) {
  const roleDefs = [
    { name: "admin", description: "System Administrator" },
    { name: "manager", description: "Store Manager" },
    { name: "cashier", description: "Cashier / POS Operator" },
  ] as const;

  const roles: Record<(typeof roleDefs)[number]["name"], number> = {
    admin: 0,
    manager: 0,
    cashier: 0,
  };

  for (const role of roleDefs) {
    const record = await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description, isActive: true },
      create: { name: role.name, description: role.description },
    });
    roles[role.name] = record.id;
  }

  return roles;
}

async function seedPermissions(prisma: PrismaClient) {
  for (const permission of permissions) {
    await prisma.permission.upsert({
      where: { id: permission.id },
      update: {
        name: permission.name,
        module: permission.module,
        description: permission.description,
        isActive: true,
      },
      create: {
        id: permission.id,
        name: permission.name,
        module: permission.module,
        description: permission.description,
      },
    });
  }
}

async function seedRolePermissions(
  prisma: PrismaClient,
  roles: { admin: number; manager: number; cashier: number },
) {
  await prisma.rolePermission.deleteMany({
    where: { roleId: { in: [roles.admin, roles.manager, roles.cashier] } },
  });

  const rows = [
    ...adminRolePermissions.map((rp) => ({
      roleId: roles.admin,
      permissionId: rp.permissionId,
      accessLevel: rp.accessLevel,
    })),
    ...managerRolePermissions.map((rp) => ({
      roleId: roles.manager,
      permissionId: rp.permissionId,
      accessLevel: rp.accessLevel,
    })),
    ...cashierRolePermissions.map((rp) => ({
      roleId: roles.cashier,
      permissionId: rp.permissionId,
      accessLevel: rp.accessLevel,
    })),
  ];

  await prisma.rolePermission.createMany({ data: rows });
}

async function seedAdminUser(prisma: PrismaClient, adminRoleId: number) {
  return bootstrapAdministrator({
    adminRoleId,
    environment: {
      BOOTSTRAP_ADMIN_USERNAME: process.env.BOOTSTRAP_ADMIN_USERNAME,
      BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD,
      BOOTSTRAP_ADMIN_PIN: process.env.BOOTSTRAP_ADMIN_PIN,
    },
    hashPassword: (password) => bcrypt.hash(password, 12),
    hashPin,
    transaction: (operation) =>
      prisma.$transaction((transaction) =>
        operation({
          countAdministrators: (roleId) =>
            transaction.user.count({ where: { roleId } }),
          findUserByUsername: (username) =>
            transaction.user.findUnique({
              where: { username },
              select: { id: true, roleId: true },
            }),
          createAdministrator: (input) =>
            transaction.user.create({
              data: {
                username: input.username,
                fullName: input.fullName,
                passwordHash: input.passwordHash,
                pin: input.pinHash,
                roleId: input.roleId,
                isActive: input.isActive,
              },
              select: { id: true },
            }),
        }),
      ),
  });
}

async function seedPaymentMethods(prisma: PrismaClient) {
  for (const method of paymentMethods) {
    await prisma.paymentMethod.upsert({
      where: { id: method.id },
      update: {
        name: method.name,
        code: method.code,
        isDigital: method.isDigital,
        isActive: true,
      },
      create: method,
    });
  }
}

async function seedTaxRates(prisma: PrismaClient) {
  for (const taxRate of taxRates) {
    await prisma.taxRate.upsert({
      where: { id: taxRate.id },
      update: {
        name: taxRate.name,
        rate: taxRate.rate,
        isInclusive: taxRate.isInclusive,
        isActive: true,
      },
      create: taxRate,
    });
  }
}

async function seedAppSettings(prisma: PrismaClient) {
  for (const setting of appSettings) {
    await prisma.appSetting.upsert({
      where: { key: setting.key },
      update: {
        value: setting.value,
        dataType: setting.dataType,
        group: setting.group,
        description: setting.description ?? null,
        isActive: true,
      },
      create: setting,
    });
  }

  await prisma.appSetting.updateMany({
    where: { key: "AutoPrintKOT" },
    data: { isActive: false },
  });
}

async function seedTerminal(prisma: PrismaClient) {
  await prisma.terminal.upsert({
    where: { id: 1 },
    update: { name: "Main Counter", location: "Front checkout", isActive: true },
    create: {
      id: 1,
      name: "Main Counter",
      location: "Front checkout",
    },
  });
}

async function seedRetailCatalog(prisma: PrismaClient) {
  const categories = [
    { id: 1, name: "Bakery", description: "Bread and baked goods", displayOrder: 1 },
    { id: 2, name: "Dairy", description: "Milk, eggs, and dairy", displayOrder: 2 },
    { id: 3, name: "Grocery", description: "Staples and pantry", displayOrder: 3 },
  ];

  for (const cat of categories) {
    await prisma.productCategory.upsert({
      where: { id: cat.id },
      update: { ...cat, isActive: true },
      create: cat,
    });
  }

  const products = [
    {
      id: 1,
      name: "White Bread Loaf",
      sku: "BRD-001",
      barcode: "8901001001001",
      basePrice: 15000n,
      costPrice: 9500n,
      categoryId: 1,
      taxRateId: 1,
      currentStock: new Prisma.Decimal(48),
      reorderLevel: new Prisma.Decimal(12),
      displayOrder: 1,
    },
    {
      id: 2,
      name: "Fresh Milk 1L",
      sku: "MLK-001",
      barcode: "8901001001002",
      basePrice: 28000n,
      costPrice: 22000n,
      categoryId: 2,
      taxRateId: 1,
      unitOfMeasure: "L",
      currentStock: new Prisma.Decimal(60),
      reorderLevel: new Prisma.Decimal(20),
      displayOrder: 1,
    },
    {
      id: 3,
      name: "Farm Eggs (12 pack)",
      sku: "EGG-001",
      barcode: "8901001001003",
      basePrice: 35000n,
      costPrice: 28000n,
      categoryId: 2,
      taxRateId: 1,
      currentStock: new Prisma.Decimal(36),
      reorderLevel: new Prisma.Decimal(10),
      displayOrder: 2,
    },
    {
      id: 4,
      name: "Basmati Rice 5kg",
      sku: "RCE-001",
      barcode: "8901001001004",
      basePrice: 120000n,
      costPrice: 98000n,
      categoryId: 3,
      taxRateId: 1,
      unitOfMeasure: "kg",
      isWeighted: false,
      currentStock: new Prisma.Decimal(25),
      reorderLevel: new Prisma.Decimal(8),
      displayOrder: 1,
    },
    {
      id: 5,
      name: "Refined Sugar 1kg",
      sku: "SGR-001",
      barcode: "8901001001005",
      basePrice: 18000n,
      costPrice: 14000n,
      categoryId: 3,
      taxRateId: 1,
      unitOfMeasure: "kg",
      currentStock: new Prisma.Decimal(40),
      reorderLevel: new Prisma.Decimal(15),
      displayOrder: 2,
    },
    {
      id: 6,
      name: "Brown Bread",
      sku: "BRD-002",
      barcode: "8901001001006",
      basePrice: 17000n,
      costPrice: 11000n,
      categoryId: 1,
      taxRateId: 1,
      currentStock: new Prisma.Decimal(30),
      reorderLevel: new Prisma.Decimal(8),
      displayOrder: 2,
    },
    {
      id: 7,
      name: "Yogurt 500g",
      sku: "DRY-001",
      barcode: "8901001001007",
      basePrice: 22000n,
      costPrice: 17000n,
      categoryId: 2,
      taxRateId: 1,
      currentStock: new Prisma.Decimal(25),
      reorderLevel: new Prisma.Decimal(6),
      displayOrder: 3,
    },
    {
      id: 8,
      name: "Cooking Oil 1L",
      sku: "GRC-001",
      barcode: "8901001001008",
      basePrice: 59000n,
      costPrice: 52000n,
      categoryId: 3,
      taxRateId: 1,
      currentStock: new Prisma.Decimal(20),
      reorderLevel: new Prisma.Decimal(7),
      displayOrder: 3,
    },
    {
      id: 9,
      name: "Black Tea 250g",
      sku: "GRC-002",
      barcode: "8901001001009",
      basePrice: 45000n,
      costPrice: 38000n,
      categoryId: 3,
      taxRateId: 1,
      currentStock: new Prisma.Decimal(18),
      reorderLevel: new Prisma.Decimal(5),
      displayOrder: 4,
    },
    {
      id: 10,
      name: "Cheese Slices",
      sku: "DRY-002",
      barcode: "8901001001010",
      basePrice: 48000n,
      costPrice: 42000n,
      categoryId: 2,
      taxRateId: 1,
      currentStock: new Prisma.Decimal(16),
      reorderLevel: new Prisma.Decimal(4),
      displayOrder: 4,
    },
    {
      id: 11,
      name: "Multigrain Flour 5kg",
      sku: "GRC-003",
      barcode: "8901001001011",
      basePrice: 87000n,
      costPrice: 79000n,
      categoryId: 3,
      taxRateId: 1,
      currentStock: new Prisma.Decimal(12),
      reorderLevel: new Prisma.Decimal(4),
      displayOrder: 5,
    },
    {
      id: 12,
      name: "Cup Cakes Pack",
      sku: "BRD-003",
      barcode: "8901001001012",
      basePrice: 26000n,
      costPrice: 18000n,
      categoryId: 1,
      taxRateId: 1,
      currentStock: new Prisma.Decimal(22),
      reorderLevel: new Prisma.Decimal(6),
      displayOrder: 3,
    },
    {
      id: 13,
      name: "Butter Salted",
      sku: "DRY-003",
      barcode: "8901001001013",
      basePrice: 33000n,
      costPrice: 27000n,
      categoryId: 2,
      taxRateId: 1,
      currentStock: new Prisma.Decimal(20),
      reorderLevel: new Prisma.Decimal(6),
      displayOrder: 5,
    },
    {
      id: 14,
      name: "Lentils Mix 1kg",
      sku: "GRC-004",
      barcode: "8901001001014",
      basePrice: 24000n,
      costPrice: 19000n,
      categoryId: 3,
      taxRateId: 1,
      currentStock: new Prisma.Decimal(28),
      reorderLevel: new Prisma.Decimal(10),
      displayOrder: 6,
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { id: product.id },
      update: { ...product, isActive: true },
      create: product,
    });
  }
}

async function seedSuppliersAndEmployee(prisma: PrismaClient) {
  await prisma.supplier.upsert({
    where: { id: 1 },
    update: { name: "FreshFoods Distributors", isActive: true },
    create: { id: 1, name: "FreshFoods Distributors", phone: "+92-301-1111111", city: "Lahore" },
  });
  await prisma.supplier.upsert({
    where: { id: 2 },
    update: { name: "Daily Essentials Pvt Ltd", isActive: true },
    create: { id: 2, name: "Daily Essentials Pvt Ltd", phone: "+92-302-2222222", city: "Lahore" },
  });

  await prisma.employee.upsert({
    where: { id: 1 },
    update: { name: "Ali Raza", isActive: true },
    create: {
      id: 1,
      name: "Ali Raza",
      employmentType: "FullTime",
      category: "Cashier",
      basicSalary: 6000000n,
      allowances: 500000n,
      deductions: 100000n,
    },
  });
}

async function main() {
  const prisma = createPrismaClient();

  try {
    console.log("Seeding GroceryRMS...");

    const roles = await seedRoles(prisma);
    await seedPermissions(prisma);
    await seedRolePermissions(prisma, roles);
    const administratorResult = await seedAdminUser(prisma, roles.admin);
    if (administratorResult.status === "failed-validation") {
      throw new Error(administratorResult.message);
    }
    await seedPaymentMethods(prisma);
    await seedTaxRates(prisma);
    await seedAppSettings(prisma);
    await seedTerminal(prisma);
    await seedRetailCatalog(prisma);
    await seedSuppliersAndEmployee(prisma);

    console.log("Seed complete.");
    console.log(`  Roles:           3 (admin, manager, cashier)`);
    console.log(`  Permissions:     ${permissions.length}`);
    console.log(
      `  RolePermissions: ${adminRolePermissions.length + managerRolePermissions.length + cashierRolePermissions.length} (27 + 22 + 12 = 61)`,
    );
    console.log(`  Payment methods: ${paymentMethods.length}`);
    console.log(`  Tax rates:       ${taxRates.length}`);
    console.log(`  App settings:    ${appSettings.length}`);
    console.log(`  Terminal:        Lane 1 (id=1)`);
    console.log(`  Sample products: 5 (Bread, Milk, Eggs, Rice, Sugar)`);
    console.log(
      administratorResult.status === "created"
        ? "  Administrator:   created"
        : "  Administrator:   existing account preserved",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
