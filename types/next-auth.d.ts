declare module "next-auth" {
  interface Session {
    expired?: boolean;
    /** Server-only, non-enumerable context. Never serialized to clients. */
    authoritative?: {
      sessionId: string;
      authVersion: number;
      terminalId: number | null;
    };
    user: {
      id: number;
      roleId: number;
      permissions: string[];
      mustChangePassword: boolean;
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
    mustChangePassword: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: number;
    roleId?: number;
    permissions?: string[];
    sessionId?: string;
    authVersion?: number;
    terminalId?: number | null;
    mustChangePassword?: boolean;
    lastActivityAt?: number;
    expired?: boolean;
  }
}

export {};
