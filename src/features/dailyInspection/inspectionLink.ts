import { labAppRoute } from '../../utils/appRoutes';

/** Query parameter of the 기록 tab that opens a side view directly. */
export const LOG_VIEW_PARAM = 'view';

/** The 기록 tab opened on today's daily inspection. */
export function dailyInspectionRoute(): string {
    return `${labAppRoute('/logs')}?${LOG_VIEW_PARAM}=inspection`;
}
