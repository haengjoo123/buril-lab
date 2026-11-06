// Fixture copy of src/services/opsAdminService (see ../vite.config.ts): the real module, except the list call.
import { serviceStubs } from '../serviceStubs';

export * from '../../../src/services/opsAdminService';
export const listSafetyCenterApprovals: typeof serviceStubs.listSafetyCenterApprovals = () => serviceStubs.listSafetyCenterApprovals();
