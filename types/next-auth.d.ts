declare module "next-auth" {
  interface Session {
    expired?: boolean;
    user: {
      id: number;
      roleId: number;
      permissions: string[];
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }

  interface User {
    roleId: number;
    permissions: string[];
    sessionId: string;
    authVersion: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: number;
    roleId?: number;
    permissions?: string[];
    sessionId?: string;
    authVersion?: number;
    lastActivityAt?: number;
    expired?: boolean;
  }
}

export {};
