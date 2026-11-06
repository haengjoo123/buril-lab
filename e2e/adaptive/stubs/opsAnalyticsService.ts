// Fixture copy of src/services/opsAnalyticsService (see ../vite.config.ts): the real module, except the summary call.
import { serviceStubs } from '../serviceStubs';

export * from '../../../src/services/opsAnalyticsService';
export const loadAnalyticsSummary: typeof serviceStubs.loadAnalyticsSummary = (days, options) => serviceStubs.loadAnalyticsSummary(days, options);
