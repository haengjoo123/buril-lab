// Fixture copy of src/services/feedbackAdminService (see ../vite.config.ts): the real module, except the list call.
import { serviceStubs } from '../serviceStubs';

export * from '../../../src/services/feedbackAdminService';
export const listFeedbackInbox: typeof serviceStubs.listFeedbackInbox = () => serviceStubs.listFeedbackInbox();
