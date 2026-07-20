import { prisma } from "@/lib/prisma";

async function getSyncSettings() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ["SyncEnabled", "SyncServerUrl"] } },
  });
  const byKey = rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
  return {
    enabled: byKey.SyncEnabled === "true",
    url: byKey.SyncServerUrl ?? "",
  };
}

export async function getSyncStatus() {
  const settings = await getSyncSettings();
  const [pending, failed, synced] = await Promise.all([
    prisma.syncQueue.count({ where: { status: "Pending" } }),
    prisma.syncQueue.count({ where: { status: "Failed" } }),
    prisma.syncQueue.count({ where: { status: "Synced" } }),
  ]);
  const lastSynced = await prisma.syncQueue.findFirst({
    where: { status: "Synced" },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });

  return {
    enabled: settings.enabled,
    serverUrl: settings.url,
    pendingCount: pending,
    failedCount: failed,
    syncedCount: synced,
    pending,
    failed,
    synced,
    lastSyncedAt: lastSynced?.updatedAt?.toISOString() ?? null,
  };
}

export async function processSyncQueue() {
  const settings = await getSyncSettings();
  if (!settings.enabled || !settings.url) {
    return { processed: 0, skipped: true };
  }

  const rows = await prisma.syncQueue.findMany({
    where: { status: { in: ["Pending", "Failed"] }, retries: { lte: 5 } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  let processed = 0;
  for (const row of rows) {
    await prisma.syncQueue.update({
      where: { id: row.id },
      data: { status: "Syncing" },
    });

    try {
      const response = await fetch(settings.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableName: row.tableName,
          recordId: row.recordId,
          operation: row.operation,
          payload: row.payload ? JSON.parse(row.payload) : null,
        }),
      });
      if (!response.ok) {
        throw new Error(`Sync server responded ${response.status}`);
      }
      await prisma.syncQueue.update({
        where: { id: row.id },
        data: { status: "Synced", errorMessage: null },
      });
      processed += 1;
    } catch (error) {
      await prisma.syncQueue.update({
        where: { id: row.id },
        data: {
          status: "Failed",
          retries: { increment: 1 },
          errorMessage: error instanceof Error ? error.message : "Sync failed",
        },
      });
    }
  }
  return { processed, skipped: false };
}

export async function retryFailedSync() {
  await prisma.syncQueue.updateMany({
    where: { status: "Failed", retries: { lt: 5 } },
    data: { status: "Pending", errorMessage: null },
  });
  return processSyncQueue();
}
