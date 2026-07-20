export const AUTH_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const SESSION_REVOCATION_REASONS = {
  LOGOUT: "logout",
  ADMINISTRATOR: "administrator",
  CREDENTIAL_CHANGE: "credential-change",
  PASSWORD_CHANGE: "password-change",
  ACCOUNT_STATUS_CHANGE: "account-status-change",
  ROLE_CHANGE: "role-change",
  ROLE_PERMISSIONS_CHANGE: "role-permissions-change",
  LOGOUT_ALL: "logout-all",
} as const;

export type SessionRevocationReason =
  (typeof SESSION_REVOCATION_REASONS)[keyof typeof SESSION_REVOCATION_REASONS];
