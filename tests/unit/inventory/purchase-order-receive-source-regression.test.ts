import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const service = () => read("lib/services/inventory-service.ts");
const concurrency = () => read("lib/inventory/purchase-order-receive.ts");
const route = () => read("app/api/inventory/purchase-orders/[id]/receive/route.ts");
const receiveBlock = () => {
  const source = service();
  const start = source.indexOf("export async function receivePurchaseOrder");
  const end = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
};

describe("purchase-order receive structural regression", () => {
  it("uses one outer interactive transaction", () => {
    const block = receiveBlock();
    expect(block.match(/prisma\.\$transaction/g)).toHaveLength(1);
  });

  it("uses only the transaction client for protected writes", () => {
    const block = receiveBlock();
    expect(block).not.toMatch(/\bprisma\.(purchaseOrder|purchaseOrderItem|product|stockMovement|auditLog)\./);
    expect(block).toContain("tx.product.update");
    expect(block).toContain("tx.stockMovement.create");
  });

  it("claims through positive eligible-state updateMany", () => {
    expect(concurrency()).toMatch(/purchaseOrder\.updateMany\(\{[\s\S]*status:\s*\{\s*in:/);
    expect(concurrency()).toContain("RECEIVABLE_PURCHASE_ORDER_STATUSES");
    expect(concurrency()).toContain("claimed.count === 1");
  });

  it("does not use broad negative status predicates", () => {
    expect(concurrency()).not.toMatch(/status:\s*\{\s*not(?:In)?:/);
    expect(concurrency()).not.toMatch(/status\s*!==?\s*[\"']Received/);
  });

  it("keeps in-transaction validation and CAS on the same allowlist", () => {
    expect(concurrency()).toContain("isReceivablePurchaseOrderStatus");
    expect(concurrency()).toMatch(/status:\s*\{\s*in:\s*\[\.\.\.RECEIVABLE_PURCHASE_ORDER_STATUSES\]/);
  });

  it("line updates use exact-prior updateMany CAS", () => {
    expect(concurrency()).toMatch(/purchaseOrderItem\.updateMany\(\{/);
    expect(concurrency()).toContain("quantityReceived: input.priorQuantity");
    expect(concurrency()).toContain("updated.count !== 1");
  });

  it("product stock uses an atomic increment", () => {
    expect(service()).toMatch(/currentStock:\s*\{\s*increment:\s*qty\s*\}/);
    expect(service()).not.toMatch(/currentStock:\s*(?:poItem|product)\./);
  });

  it("does not create per-line or nested transactions", () => {
    const block = receiveBlock();
    const loop = block.slice(block.indexOf("for (const row of items)"));
    expect(loop).not.toContain("$transaction");
  });

  it("keeps movement creation before required audit and response read", () => {
    const block = receiveBlock();
    expect(block.indexOf("tx.stockMovement.create")).toBeLessThan(
      block.indexOf("writeRequiredAudit(tx"),
    );
    expect(block.indexOf("writeRequiredAudit(tx")).toBeLessThan(
      block.indexOf("tx.purchaseOrder.findUniqueOrThrow"),
    );
  });

  it("keeps required audit inside the service transaction", () => {
    expect(service()).toContain("writeRequiredAudit(tx,");
    expect(route()).not.toContain("auditFromRequest");
  });

  it("does not add durable request idempotency", () => {
    expect(route()).not.toMatch(/idempotency-key|Idempotency-Key/i);
    expect(receiveBlock()).not.toContain("executeFinancialIdempotent");
    expect(concurrency()).not.toContain("idempotency");
  });

  it("does not couple inventory receiving to discount ownership", () => {
    for (const source of [service(), concurrency(), route()]) {
      expect(source).not.toMatch(/discount|managerApproval|financial-idempotency/i);
    }
  });

  it("preserves the schema's product-only PO line model", () => {
    const schema = read("prisma/schema.prisma");
    const start = schema.indexOf("model PurchaseOrderItem");
    const end = schema.indexOf("\nmodel ", start + 1);
    const model = schema.slice(start, end);
    expect(model).toContain("productId");
    expect(model).toContain("quantityReceived");
    expect(model).not.toContain("variantId");
  });

  it("has no receive-side frontend caller to change", () => {
    for (const directory of ["components", "hooks", "stores"]) {
      const source = readFileTree(directory);
      expect(source).not.toContain("/api/inventory/purchase-orders/");
      expect(source).not.toContain("receivedQty");
    }
  });
});

function readFileTree(directory: string): string {
  const entries = readdirSync(path.resolve(directory), { withFileTypes: true });
  return entries
    .flatMap((entry) => {
      const fullPath = path.resolve(directory, entry.name);
      if (entry.isDirectory()) return readFileTree(fullPath);
      return statSync(fullPath).isFile() ? readFileSync(fullPath, "utf8") : "";
    })
    .join("\n");
}
