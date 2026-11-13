import type { DailyInspectionErrorCode } from '../../services/dailyInspectionService';
import type { InspectionResult } from './inspectionSummary';

const KO = {
    tab: '일상점검',
    title: '오늘의 일상점검',
    intro: '실험을 시작하기 전에 항목을 확인하고 기록하세요. 하루에 한 건이 남고, 같은 날 다시 저장하면 그날 기록을 고칩니다.',
    labOnly: '일상점검은 연구실 공간에서 기록합니다. 위에서 연구실을 선택하세요.',
    loading: '점검 기록을 불러오는 중입니다.',
    loadFailed: '점검 기록을 불러오지 못했습니다.',
    retry: '다시 시도',
    todayDone: (name: string | null) => (name ? `오늘 점검 완료 · ${name}` : '오늘 점검 완료'),
    todayIssues: (count: number) => `오늘 점검 완료 · 불량 ${count}건`,
    todayMissing: '오늘 점검이 아직 기록되지 않았습니다.',
    historyTitle: (days: number) => `최근 ${days}일`,
    historyDone: '점검함',
    historyIssues: '불량 있음',
    historyMissing: '기록 없음',
    historyRate: (done: number, days: number) => `${days}일 중 ${done}일 기록`,
    progress: (answered: number, total: number) => `${answered} / ${total} 항목`,
    issues: (count: number) => `불량 ${count}건`,
    sectionNa: '이 구역 해당 없음',
    fillOk: '남은 항목 모두 양호',
    note: '지시사항·특이사항 (선택)',
    notePlaceholder: '불량 항목의 조치 내용이나 전달할 사항을 적으세요.',
    save: '점검 기록 저장',
    update: '오늘 기록 수정',
    saving: '저장 중',
    saved: '점검 기록을 저장했습니다.',
    incomplete: (count: number) => `확인하지 않은 항목이 ${count}개 있습니다.`,
    legalNote: '이 기록은 연구실 일상점검 기록을 돕기 위한 것입니다. 점검 항목과 보존 의무는 소속 기관의 지침과 현행 고시를 따르세요.',
    centerTitle: '일상점검 이행 현황',
    centerHelp: (days: number) => `요약 범위로 연결된 연구실의 최근 ${days}일 기록입니다. 항목별 결과와 메모는 연구실 안에서만 보입니다.`,
    centerLoading: '이행 현황을 불러오는 중입니다.',
    centerFailed: '이행 현황을 불러오지 못했습니다.',
    centerEmpty: '표시할 연구실이 없습니다.',
    centerLab: '연구실',
    centerDays: '기록한 날',
    centerIssueDays: '불량이 있던 날',
    centerLast: '마지막 기록',
    centerNever: '기록 없음',
};

const EN: typeof KO = {
    tab: 'Daily check',
    title: "Today's daily inspection",
    intro: 'Check the items before starting work and record the result. One record is kept per day; saving again the same day updates it.',
    labOnly: 'Daily inspections are recorded in a lab space. Choose a lab above.',
    loading: 'Loading inspection records.',
    loadFailed: 'Could not load inspection records.',
    retry: 'Retry',
    todayDone: (name: string | null) => (name ? `Inspected today · ${name}` : 'Inspected today'),
    todayIssues: (count: number) => `Inspected today · ${count} issue(s)`,
    todayMissing: "Today's inspection has not been recorded yet.",
    historyTitle: (days: number) => `Last ${days} days`,
    historyDone: 'Inspected',
    historyIssues: 'Issues found',
    historyMissing: 'No record',
    historyRate: (done: number, days: number) => `Recorded on ${done} of ${days} days`,
    progress: (answered: number, total: number) => `${answered} / ${total} items`,
    issues: (count: number) => `${count} issue(s)`,
    sectionNa: 'Section not applicable',
    fillOk: 'Mark the rest satisfactory',
    note: 'Instructions and remarks (optional)',
    notePlaceholder: 'Describe the action taken for any issue, or anything to pass on.',
    save: 'Save inspection',
    update: "Update today's record",
    saving: 'Saving',
    saved: 'Inspection saved.',
    incomplete: (count: number) => `${count} item(s) have not been checked.`,
    legalNote: 'This record helps you keep daily lab inspection records. Follow your institution\'s guidance and the notice currently in force for the items and retention duties.',
    centerTitle: 'Daily inspection compliance',
    centerHelp: (days: number) => `Records of the last ${days} days for labs linked with the summary scope. Item results and notes stay inside the lab.`,
    centerLoading: 'Loading compliance.',
    centerFailed: 'Could not load compliance.',
    centerEmpty: 'No labs to show.',
    centerLab: 'Lab',
    centerDays: 'Days recorded',
    centerIssueDays: 'Days with issues',
    centerLast: 'Last record',
    centerNever: 'No record',
};

export type InspectionCopy = typeof KO;

export function inspectionCopy(language: string): InspectionCopy {
    return language.startsWith('ko') ? KO : EN;
}

const RESULT_KO: Record<InspectionResult, string> = { ok: '양호', bad: '불량', na: '해당 없음' };
const RESULT_EN: Record<InspectionResult, string> = { ok: 'OK', bad: 'Issue', na: 'N/A' };

export function inspectionResultLabel(result: InspectionResult, language: string): string {
    return (language.startsWith('ko') ? RESULT_KO : RESULT_EN)[result];
}

const ERROR_KO: Record<DailyInspectionErrorCode, string> = {
    access_denied: '이 연구실의 점검을 기록할 권한이 없습니다.',
    invalid_input: '입력값을 확인하세요. 메모는 1,000자까지 쓸 수 있습니다.',
    unknown: '점검 기록을 저장하지 못했습니다. 잠시 후 다시 시도하세요.',
};
const ERROR_EN: Record<DailyInspectionErrorCode, string> = {
    access_denied: 'You cannot record inspections for this lab.',
    invalid_input: 'Check the values. The note can be up to 1,000 characters.',
    unknown: 'Could not save the inspection. Try again shortly.',
};

export function inspectionErrorMessage(code: DailyInspectionErrorCode, language: string): string {
    return (language.startsWith('ko') ? ERROR_KO : ERROR_EN)[code];
}
