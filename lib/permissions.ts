import { prisma } from "@/lib/prisma";

/**
 * GroceryRMS retail matrix uses 24 permissions (not RPOS restaurant 27).
 * Original RPOS IDs 11 ("Manage tables & sessions") and 18 ("View kitchen orders")
 * were intentionally dropped — no Kitchen, Floor Plan, or Table permissions exist here.
 */

/** Permission tokens: `"Permission Name:accessLevel"` from RolePermission matrix */
export async function loadPermissionTokensForRole(
  roleId: number,
): Promise<string[]> {
  const rows = await prisma.rolePermission.findMany({
    where: {
      roleId,
      permission: { isActive: true },
    },
    include: { permission: true },
  });

  return rows.map((rp) => `${rp.permission.name}:${rp.accessLevel}`);
}

export function parsePermissionToken(token: string): {
  name: string;
  accessLevel: number;
} {
  const lastColon = token.lastIndexOf(":");
  if (lastColon === -1) {
    return { name: token, accessLevel: 0 };
  }
  return {
    name: token.slice(0, lastColon),
    accessLevel: Number.parseInt(token.slice(lastColon + 1), 10) || 0,
  };
}

export function hasPermission(
  permissions: string[],
  permissionName: string,
  minimumLevel = 1,
): boolean {
  const target = permissionName.toLowerCase();
  return permissions.some((token) => {
    const { name, accessLevel } = parsePermissionToken(token);
    return name.toLowerCase() === target && accessLevel >= minimumLevel;
  });
}

export async function getAccessLevel(
  userId: number,
  permissionName: string,
): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: {
        select: {
          rolePermissions: {
            where: {
              permission: {
                name: permissionName,
                isActive: true,
              },
            },
            select: { accessLevel: true },
            take: 1,
          },
        },
      },
    },
  });

  return user?.role.rolePermissions[0]?.accessLevel ?? 0;
}

export async function checkPermission(
  userId: number,
  permissionName: string,
  minimumLevel = 1,
): Promise<boolean> {
  const level = await getAccessLevel(userId, permissionName);
  return level >= minimumLevel;
}
