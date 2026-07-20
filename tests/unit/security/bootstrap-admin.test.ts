import { describe, expect, it, vi } from "vitest";
import {
  bootstrapAdministrator,
  type BootstrapAdministratorCreateInput,
  type BootstrapAdministratorDependencies,
} from "../../../prisma/seed/bootstrap-admin";

interface TestUser {
  id: number;
  username: string;
  roleId: number;
  isActive: boolean;
  passwordHash: string;
  pin: string | null;
}

const ADMIN_ROLE_ID = 10;
const NON_ADMIN_ROLE_ID = 20;
const validPassword = (label = "initial") =>
  `test-only ${label} ${"phrase ".repeat(3)}`;

function createHarness(
  users: TestUser[] = [],
  environment: BootstrapAdministratorDependencies["environment"] = {
    BOOTSTRAP_ADMIN_USERNAME: "primary-admin",
    BOOTSTRAP_ADMIN_PASSWORD: validPassword(),
    BOOTSTRAP_ADMIN_PIN: "4826",
  },
) {
  const state = { users: structuredClone(users) };
  const createInputs: BootstrapAdministratorCreateInput[] = [];
  const hashPassword = vi.fn(async () => "test-password-hash");
  const hashPin = vi.fn(() => "test-pin-hash");
  const transactionSpy = vi.fn();
  const transaction: BootstrapAdministratorDependencies["transaction"] = async (
    operation,
  ) => {
    transactionSpy();
    return operation({
      countAdministrators: async (roleId) =>
        state.users.filter((user) => user.roleId === roleId).length,
      findUserByUsername: async (username) => {
        const user = state.users.find(
          (candidate) => candidate.username === username,
        );
        return user ? { id: user.id, roleId: user.roleId } : null;
      },
      createAdministrator: async (input) => {
        createInputs.push(structuredClone(input));
        const user = {
          id: state.users.length + 1,
          username: input.username,
          roleId: input.roleId,
          isActive: input.isActive,
          passwordHash: input.passwordHash,
          pin: input.pinHash,
        };
        state.users.push(user);
        return { id: user.id };
      },
    });
  };

  const dependencies: BootstrapAdministratorDependencies = {
    adminRoleId: ADMIN_ROLE_ID,
    environment,
    transaction,
    hashPassword,
    hashPin,
  };

  return {
    dependencies,
    state,
    createInputs,
    hashPassword,
    hashPin,
    transaction: transactionSpy,
  };
}

function existingAdministrator(isActive: boolean, id = 1): TestUser {
  return {
    id,
    username: `existing-admin-${id}`,
    roleId: ADMIN_ROLE_ID,
    isActive,
    passwordHash: `preserved-password-hash-${id}`,
    pin: `preserved-pin-hash-${id}`,
  };
}

describe("administrator preservation", () => {
  it.each([true, false])(
    "preserves an existing administrator with active state %s",
    async (isActive) => {
      const original = existingAdministrator(isActive);
      const harness = createHarness([original], {});

      const result = await bootstrapAdministrator(harness.dependencies);

      expect(result).toEqual({
        status: "preserved-existing",
        administratorCount: 1,
      });
      expect(harness.state.users).toEqual([original]);
      expect(harness.hashPassword).not.toHaveBeenCalled();
      expect(harness.hashPin).not.toHaveBeenCalled();
      expect(harness.createInputs).toHaveLength(0);
    },
  );

  it("ignores supplied replacement credentials for an existing administrator", async () => {
    const original = existingAdministrator(true);
    const harness = createHarness([original], {
      BOOTSTRAP_ADMIN_USERNAME: "replacement-admin",
      BOOTSTRAP_ADMIN_PASSWORD: validPassword("replacement"),
      BOOTSTRAP_ADMIN_PIN: "5937",
    });

    await bootstrapAdministrator(harness.dependencies);

    expect(harness.state.users).toEqual([original]);
    expect(harness.hashPassword).not.toHaveBeenCalled();
    expect(harness.hashPin).not.toHaveBeenCalled();
  });

  it("preserves multiple administrators and creates none", async () => {
    const harness = createHarness([
      existingAdministrator(true, 1),
      existingAdministrator(false, 2),
    ]);

    await expect(bootstrapAdministrator(harness.dependencies)).resolves.toEqual({
      status: "preserved-existing",
      administratorCount: 2,
    });
    expect(harness.createInputs).toHaveLength(0);
  });
});

describe("first administrator bootstrap", () => {
  it("creates one administrator with the authoritative role", async () => {
    const harness = createHarness();

    await expect(bootstrapAdministrator(harness.dependencies)).resolves.toEqual({
      status: "created",
      administratorId: 1,
    });
    expect(harness.createInputs).toHaveLength(1);
    expect(harness.createInputs[0]).toMatchObject({
      username: "primary-admin",
      roleId: ADMIN_ROLE_ID,
      isActive: true,
      passwordHash: "test-password-hash",
      pinHash: "test-pin-hash",
    });
    expect(harness.transaction).toHaveBeenCalledOnce();
  });

  it("hashes the exact password without passing plaintext to the store", async () => {
    const password = `  ${validPassword("spacing")}`;
    const harness = createHarness([], {
      BOOTSTRAP_ADMIN_USERNAME: "primary-admin",
      BOOTSTRAP_ADMIN_PASSWORD: password,
    });

    await bootstrapAdministrator(harness.dependencies);

    expect(harness.hashPassword).toHaveBeenCalledWith(password);
    expect(JSON.stringify(harness.createInputs[0])).not.toContain(password);
  });

  it("hashes an optional PIN through the injected approved mechanism", async () => {
    const harness = createHarness();

    await bootstrapAdministrator(harness.dependencies);

    expect(harness.hashPin).toHaveBeenCalledWith("4826");
    expect(harness.createInputs[0].pinHash).toBe("test-pin-hash");
  });

  it("stores no PIN hash when the optional PIN is omitted", async () => {
    const harness = createHarness([], {
      BOOTSTRAP_ADMIN_USERNAME: "primary-admin",
      BOOTSTRAP_ADMIN_PASSWORD: validPassword(),
    });

    await bootstrapAdministrator(harness.dependencies);

    expect(harness.hashPin).not.toHaveBeenCalled();
    expect(harness.createInputs[0].pinHash).toBeNull();
  });

  it.each([
    [{ BOOTSTRAP_ADMIN_PASSWORD: validPassword() }, "BOOTSTRAP_ADMIN_USERNAME_REQUIRED"],
    [{ BOOTSTRAP_ADMIN_USERNAME: "primary-admin" }, "BOOTSTRAP_ADMIN_PASSWORD_REQUIRED"],
    [
      {
        BOOTSTRAP_ADMIN_USERNAME: "primary-admin",
        BOOTSTRAP_ADMIN_PASSWORD: validPassword(),
        BOOTSTRAP_ADMIN_PIN: "7777",
      },
      "BOOTSTRAP_ADMIN_PIN_REPEATED_DIGITS",
    ],
  ] as const)("fails validation without mutation", async (environment, code) => {
    const harness = createHarness([], environment);

    await expect(bootstrapAdministrator(harness.dependencies)).resolves.toMatchObject({
      status: "failed-validation",
      code,
    });
    expect(harness.createInputs).toHaveLength(0);
  });

  it("fails a non-administrator username collision without promotion", async () => {
    const existingUser: TestUser = {
      id: 1,
      username: "primary-admin",
      roleId: NON_ADMIN_ROLE_ID,
      isActive: false,
      passwordHash: "preserved-non-admin-password-hash",
      pin: null,
    };
    const harness = createHarness([existingUser]);

    await expect(bootstrapAdministrator(harness.dependencies)).resolves.toMatchObject({
      status: "failed-validation",
      code: "BOOTSTRAP_ADMIN_USERNAME_COLLISION",
    });
    expect(harness.state.users).toEqual([existingUser]);
    expect(harness.hashPassword).not.toHaveBeenCalled();
    expect(harness.hashPin).not.toHaveBeenCalled();
  });
});

describe("bootstrap idempotency and secret handling", () => {
  it("creates once and preserves credentials on the second invocation", async () => {
    const harness = createHarness();

    const first = await bootstrapAdministrator(harness.dependencies);
    harness.dependencies.environment = {
      BOOTSTRAP_ADMIN_USERNAME: "another-admin",
      BOOTSTRAP_ADMIN_PASSWORD: validPassword("changed"),
      BOOTSTRAP_ADMIN_PIN: "5937",
    };
    const second = await bootstrapAdministrator(harness.dependencies);

    expect(first.status).toBe("created");
    expect(second).toEqual({
      status: "preserved-existing",
      administratorCount: 1,
    });
    expect(harness.createInputs).toHaveLength(1);
    expect(harness.hashPassword).toHaveBeenCalledTimes(1);
    expect(harness.hashPin).toHaveBeenCalledTimes(1);
    expect(harness.state.users[0]).toMatchObject({
      passwordHash: "test-password-hash",
      pin: "test-pin-hash",
    });
  });

  it("does not expose secrets or hashes in result objects", async () => {
    const password = validPassword("result-check");
    const pin = "4826";
    const harness = createHarness([], {
      BOOTSTRAP_ADMIN_USERNAME: "primary-admin",
      BOOTSTRAP_ADMIN_PASSWORD: password,
      BOOTSTRAP_ADMIN_PIN: pin,
    });

    const result = await bootstrapAdministrator(harness.dependencies);
    const serializedResult = JSON.stringify(result);

    expect(serializedResult).not.toContain(password);
    expect(serializedResult).not.toContain(pin);
    expect(serializedResult).not.toContain("test-password-hash");
    expect(serializedResult).not.toContain("test-pin-hash");
  });

  it("does not write credentials to console output", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = createHarness();

    await bootstrapAdministrator(harness.dependencies);

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
