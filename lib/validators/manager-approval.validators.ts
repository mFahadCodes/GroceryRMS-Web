import { z } from "zod";
import { MANAGER_APPROVAL_ACTIONS } from "@/lib/security/manager-approval";

export const managerApprovalIssuanceSchema = z
  .object({
    managerUserId: z.number().int().positive(),
    managerPin: z.string().regex(/^[0-9]{4}$/),
    action: z.enum(MANAGER_APPROVAL_ACTIONS),
    resourceType: z.literal("order"),
    resourceId: z.number().int().positive(),
  })
  .strict();
