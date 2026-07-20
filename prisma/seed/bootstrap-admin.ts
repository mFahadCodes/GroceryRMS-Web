import {
  type BootstrapCredentialFailureCode,
  type BootstrapEnvironmentSource,
  readBootstrapEnvironment,
  validateBootstrapPassword,
  validateBootstrapPin,
  validateBootstrapUsername,
} from "./bootstrap-credential-policy";

export interface BootstrapAdministratorCreateInput {
  username: string;
  fullName: string;
  passwordHash: string;
  pinHash: string | null;
  roleId: number;
  isActive: true;
  mustChangePassword: true;
  passwordChangedAt: null;
}

export interface BootstrapAdministratorStore {
  countAdministrators(adminRoleId: number): Promise<number>;
  findUserByUsername(
    username: string,
  ): Promise<{ id: number; roleId: number } | null>;
  createAdministrator(
    input: BootstrapAdministratorCreateInput,
  ): Promise<{ id: number }>;
  updateAdministratorPin(userId: number, pinHash: string): Promise<void>;
}

export interface BootstrapAdministratorDependencies {
  adminRoleId: number;
  environment: BootstrapEnvironmentSource;
  transaction<T>(
    operation: (store: BootstrapAdministratorStore) => Promise<T>,
  ): Promise<T>;
  hashPassword(password: string): Promise<string>;
  hashPin(userId: number, pin: string): Promise<string>;
}

export type BootstrapAdministratorResult =
  | {
      status: "created";
      administratorId: number;
    }
  | {
      status: "preserved-existing";
      administratorCount: number;
    }
  | {
      status: "failed-validation";
      code:
        | BootstrapCredentialFailureCode
        | "BOOTSTRAP_ADMIN_USERNAME_COLLISION";
      message: string;
    };

export async function bootstrapAdministrator(
  dependencies: BootstrapAdministratorDependencies,
): Promise<BootstrapAdministratorResult> {
  return dependencies.transaction(async (store) => {
    const administratorCount = await store.countAdministrators(
      dependencies.adminRoleId,
    );

    if (administratorCount > 0) {
      return {
        status: "preserved-existing",
        administratorCount,
      };
    }

    const input = readBootstrapEnvironment(dependencies.environment);
    const usernameResult = validateBootstrapUsername(input.username);
    if (!usernameResult.ok) {
      return {
        status: "failed-validation",
        code: usernameResult.code,
        message: usernameResult.message,
      };
    }

    const passwordResult = validateBootstrapPassword(
      input.password,
      usernameResult.value,
    );
    if (!passwordResult.ok) {
      return {
        status: "failed-validation",
        code: passwordResult.code,
        message: passwordResult.message,
      };
    }

    const pinResult = validateBootstrapPin(input.pin);
    if (!pinResult.ok) {
      return {
        status: "failed-validation",
        code: pinResult.code,
        message: pinResult.message,
      };
    }

    const usernameCollision = await store.findUserByUsername(
      usernameResult.value,
    );
    if (usernameCollision) {
      return {
        status: "failed-validation",
        code: "BOOTSTRAP_ADMIN_USERNAME_COLLISION",
        message:
          "BOOTSTRAP_ADMIN_USERNAME already belongs to a non-administrator account; bootstrap will not promote or overwrite it.",
      };
    }

    const passwordHash = await dependencies.hashPassword(passwordResult.value);
    const administrator = await store.createAdministrator({
      username: usernameResult.value,
      fullName: "System Administrator",
      passwordHash,
      pinHash: null,
      roleId: dependencies.adminRoleId,
      isActive: true,
      mustChangePassword: true,
      passwordChangedAt: null,
    });
    if (pinResult.value) {
      const pinHash = await dependencies.hashPin(
        administrator.id,
        pinResult.value,
      );
      await store.updateAdministratorPin(administrator.id, pinHash);
    }

    return {
      status: "created",
      administratorId: administrator.id,
    };
  });
}
