import { describe, expect, it } from 'vitest';
import { buildRegisterRows, type RegisterItem } from '../hazardRegister/hazardRegister';
import { hazardRegisterCopy } from '../hazardRegister/copy';
import { CHECKLIST_VERSION } from '../dailyInspection/checklist';
import { inspectionPrepCopy } from './copy';
import { buildInspectionPrepSheets, type InspectionPrepInput } from './inspectionPrep';

const registerCopy = hazardRegisterCopy('ko');
const item = (overrides: Partial<RegisterItem>): RegisterItem => ({
    name: 'Acetone', casNumber: '67-64-1', brand: 'Daejung', quantity: 1, capacity: '1 L', location: '산 시약장',
    expiryDate: null, ghs: null, hazardGroups: [], hasSds: false, ...overrides,
});

const base = (overrides: Partial<InspectionPrepInput> = {}): InspectionPrepInput => ({
    labName: '유기합성 연구실',
    date: new Date(2026, 10, 16),
    periodDays: 90,
    register: {
        rows: buildRegisterRows([
            item({ name: 'Formalin', casNumber: '50-00-0', regulationClasses: ['제한물질', '인체등유해성물질'], hasSds: true }),
            item({ regulationClasses: [] }),
        ], registerCopy.row),
        copy: registerCopy.sheet,
    },
    actionsByCas: new Map([['50-00-0', '덜어 쓰는 용기에도 물질명과 경고표시를 붙이세요.']]),
    regulatedCasCount: 1,
    accidentCasCount: 0,
    sdsTracked: true,
    inspections: [
        { id: 'a', labId: 'l', inspectionDate: '2026-11-12', checklistVersion: CHECKLIST_VERSION, results: { chemical_toxic: 'bad', general_tidy: 'ok' }, issueCount: 1, note: '잠금장치 주문', inspectorName: '김연구', updatedAt: '' },
        { id: 'b', labId: 'l', inspectionDate: '2026-11-13', checklistVersion: CHECKLIST_VERSION, results: {}, issueCount: 0, note: null, inspectorName: null, updatedAt: '' },
    ],
    cabinets: [
        { id: 'c1', name: '산 시약장', location: '1층', locked: false },
        { id: 'c2', name: '독성 시약장', location: null, locked: true },
        { id: 'c3', name: '용매 시약장', location: null, locked: null },
    ],
    cabinetLocks: { unlocked: [{ cabinetId: 'c1', cabinetName: '산 시약장', count: 2 }], unset: [{ cabinetId: 'c3', cabinetName: '용매 시약장', count: 1 }] },
    containers: {
        list: [
            { id: 'w1', label: 'A-1', streamCode: 'ORGANIC_NON_HALOGENATED', status: 'active', location: null, sealedAt: null, fillRatio: 0.85 },
            { id: 'w2', label: 'A-2', streamCode: 'ACID', status: 'sealed', location: '복도', sealedAt: '2026-10-01T00:00:00Z', fillRatio: null },
        ],
        attentionCount: 2,
        streamLabel: (code) => `stream:${code}`,
    },
    ...overrides,
});

const sheet = (built: ReturnType<typeof buildInspectionPrepSheets>, name: string) => built.sheets.find((candidate) => candidate.name === name)!;

describe('inspection prep bundle', () => {
    const copy = inspectionPrepCopy('ko');

    it('summarizes what an inspector asks for first', () => {
        const built = buildInspectionPrepSheets(base(), copy, 'ko');
        expect(built.sheets.map((candidate) => candidate.name)).toEqual(['요약', '화학물질 보유', '일상점검 기록', '보관 점검', '폐액통 현황']);
        const summary = Object.fromEntries(sheet(built, '요약').rows);
        expect(summary).toMatchObject({
            연구실: '유기합성 연구실',
            기준일: '2026-11-16',
            '보유 시약(목록 줄 수)': 2,
            '화관법 규제물질(CAS 종 수)': 1,
            정밀안전진단: '대상 · 2년마다 1회 이상(연구실안전법 시행령 제11조)',
            '일상점검(최근 90일)': '기록 2일 · 불량이 있던 날 1일 · 마지막 기록 2026-11-13',
            'SDS 파일 보관': '2줄 중 1줄',
            '시약장 잠금장치': '있음 1 · 없음 1 · 미설정 1 · 잠금 없는 곳의 독성·발암성 물질 2개',
            폐액통: '사용 중 1 · 봉인 1 · 확인 필요 2',
        });
        expect(built.guide.join(' ')).toContain('법정 서식을 대신하지 않습니다');
    });

    it('lists chemicals with their 화관법 class and actions, newest inspections first with issue items named', () => {
        const built = buildInspectionPrepSheets(base(), copy, 'ko');
        const chemicals = sheet(built, '화학물질 보유');
        expect(chemicals.headers).toContain('화관법 분류');
        expect(chemicals.headers.at(-1)).toBe('화관법상 할 일');
        const formalin = chemicals.rows.find((row) => row.includes('Formalin'))!;
        expect(formalin).toContain('제한물질, 인체등유해성물질');
        expect(formalin.at(-1)).toBe('덜어 쓰는 용기에도 물질명과 경고표시를 붙이세요.');

        const inspections = sheet(built, '일상점검 기록').rows;
        expect(inspections.map((row) => row[0])).toEqual(['2026-11-13', '2026-11-12']);
        expect(inspections[1][3]).toContain('시건장치');
        expect(inspections[1][4]).toBe('잠금장치 주문');

        expect(sheet(built, '보관 점검').rows).toEqual([
            ['산 시약장', '1층', '없음', 2],
            ['독성 시약장', '', '있음', ''],
            ['용매 시약장', '', '미설정', 1],
        ]);
        expect(sheet(built, '폐액통 현황').rows[0]).toEqual(['A-1', 'stream:ORGANIC_NON_HALOGENATED', '사용 중', 85, '', '']);
    });

    it('says which parts are left out instead of showing empty sheets', () => {
        const built = buildInspectionPrepSheets(base({
            actionsByCas: null, regulatedCasCount: null, accidentCasCount: null, sdsTracked: false,
            inspections: null, cabinets: null, cabinetLocks: null, containers: null,
            register: { rows: buildRegisterRows([item({})], registerCopy.row), copy: registerCopy.sheet },
        }), copy, 'ko');
        expect(built.sheets.map((candidate) => candidate.name)).toEqual(['요약', '화학물질 보유']);
        const summary = Object.fromEntries(sheet(built, '요약').rows);
        expect(summary['정밀안전진단']).toBe('포함 안 됨(기능 꺼짐)');
        expect(summary['시약장 잠금장치']).toBe('포함 안 됨(기능 꺼짐)');
        expect('SDS 파일 보관' in summary).toBe(false);
        expect(sheet(built, '화학물질 보유').headers).not.toContain('화관법상 할 일');
    });
});
