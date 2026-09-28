import {
  EntitlementService as CoreEntitlementService,
  entitlementService as coreEntitlementService
} from './entitlementService';
import { PlanId, PlanLimitError } from '../../src/types';

export interface EntitlementCheckResult {
  allowed: boolean;
  current?: number;
  limit?: number;
  plan: PlanId;
  error?: PlanLimitError;
}

export { CoreEntitlementService as EntitlementService };
export const entitlementService = coreEntitlementService;
