import type { ReminderCopy } from './reminderPlan';

const KO = {
    title: '알림',
    webOnly: '알림은 iOS·Android 앱에서 받을 수 있습니다. 웹에서는 재고 화면과 관리자 할 일에 표시됩니다.',
    allow: '이 기기에서 알림 허용',
    denied: '알림 권한이 꺼져 있습니다. 기기 설정에서 버릴랩 알림을 켜 주세요.',
    expiry: '유효기한 알림',
    expiryHelp: '유효기한 30일 전, 7일 전, 당일 오전 9시에 알려 줍니다. 같은 날 만료되는 시약은 하나로 묶습니다.',
    inspection: '일상점검 알림',
    inspectionHelp: '매일 오전 9시에 오늘의 일상점검을 알려 줍니다.',
    scheduled: (count: number) => `이 기기에 알림 ${count}건이 예약되어 있습니다.`,
    note: '알림은 이 기기와 지금 공간(개인·연구실)에만 적용됩니다. 앱을 열 때마다 최신 재고로 다시 예약합니다.',
    reminder: {
        expiryTitle: (days: number) => (days === 0 ? '오늘 유효기한이 끝나는 시약이 있습니다' : `유효기한 ${days}일 전인 시약이 있습니다`),
        expiryBody: (names: string[], more: number) => `${names.join(', ')}${more > 0 ? ` 외 ${more}개` : ''}`,
        inspectionTitle: '오늘의 일상점검',
        inspectionBody: '실험을 시작하기 전에 일상점검을 기록하세요.',
    } satisfies ReminderCopy,
};

const EN: typeof KO = {
    title: 'Reminders',
    webOnly: 'Reminders are delivered by the iOS and Android apps. On the web they appear in the inventory and the admin inbox.',
    allow: 'Allow reminders on this device',
    denied: 'Notifications are turned off. Enable them for Buril Lab in the device settings.',
    expiry: 'Expiry reminders',
    expiryHelp: 'Reminds you 30 days and 7 days before, and on the expiry day, at 9:00 Korea time. Reagents expiring the same day are grouped.',
    inspection: 'Daily inspection reminder',
    inspectionHelp: "Reminds you of today's daily inspection at 9:00 Korea time.",
    scheduled: (count: number) => `${count} reminder(s) scheduled on this device.`,
    note: 'Reminders apply to this device and the current space (personal or lab). They are rescheduled from the latest inventory each time the app opens.',
    reminder: {
        expiryTitle: (days: number) => (days === 0 ? 'Reagents expire today' : `Reagents expire in ${days} days`),
        expiryBody: (names: string[], more: number) => `${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}`,
        inspectionTitle: "Today's daily inspection",
        inspectionBody: 'Record the daily inspection before starting work.',
    },
};

export type RemindersCopy = typeof KO;

export function remindersCopy(language: string): RemindersCopy {
    return language.startsWith('ko') ? KO : EN;
}
