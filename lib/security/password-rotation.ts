export function isPasswordRotationBlocked(
  mustChangePassword: boolean,
  allowPasswordChangeRequired = false,
): boolean {
  return mustChangePassword && !allowPasswordChangeRequired;
}
