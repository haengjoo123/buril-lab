import type { listFeedbackInbox } from '../../src/services/feedbackAdminService';
import type { listSafetyCenterApprovals } from '../../src/services/opsAdminService';
import type { loadAnalyticsSummary } from '../../src/services/opsAnalyticsService';

const notStubbed = (name: string) => () => Promise.reject(new Error(`${name} has no fixture answer`));

/**
 * Answers for operator calls that are plain module exports. vite.config.ts points their modules at
 * ./stubs, which call these; fixture.tsx fills them in like it reassigns `inventoryService.getItems`.
 */
export const serviceStubs: {
  listSafetyCenterApprovals: typeof listSafetyCenterApprovals;
  listFeedbackInbox: typeof listFeedbackInbox;
  loadAnalyticsSummary: typeof loadAnalyticsSummary;
} = {
  listSafetyCenterApprovals: notStubbed('listSafetyCenterApprovals'),
  listFeedbackInbox: notStubbed('listFeedbackInbox'),
  loadAnalyticsSummary: notStubbed('loadAnalyticsSummary'),
};
