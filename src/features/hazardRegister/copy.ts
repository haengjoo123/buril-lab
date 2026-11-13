import type { RegisterCopy, RegisterSheetCopy } from './hazardRegister';

const KO = {
    button: '위험분석용 목록',
    buttonTitle: '사전유해인자위험분석용 화학물질 목록(초안) 내려받기',
    failed: '목록 파일을 만들지 못했습니다.',
    row: {
        language: 'ko' as 'ko' | 'en',
        statusLoaded: '분류 있음',
        statusNotClassified: '분류 없음',
        statusNoCas: 'CAS 없음(확인 필요)',
        statusPending: '조회 전(확인 필요)',
        sdsYes: '보관',
        sdsNo: '',
        signalDanger: '위험',
        signalWarning: '경고',
    } satisfies RegisterCopy,
    sheet: {
        sheetName: '화학물질 목록',
        guideSheetName: '작성 안내',
        title: (space: string, date: string) => `사전유해인자위험분석용 화학물질 보유 목록 (초안) · ${space} · ${date}`,
        headers: ['연번', '물질명', 'CAS 번호', '제조사', '보유량', '보관 위치', '신호어', '유해·위험 문구', 'GHS 그림문자', '앱 위험 분류', 'GHS 조회 상태', 'SDS 파일', '가장 이른 유효기한'],
        manualHeaders: ['사용량(일/주)', '사용 빈도', '노출 가능 경로', '보호구', '공학적 대책', '비고'],
        guide: [
            '작성 안내',
            '이 파일은 버릴랩에 등록된 재고와 GHS 정보로 만든 초안입니다. 연구실 사전유해인자위험분석의 화학물질 항목을 작성할 때 출발점으로 쓰세요.',
            '같은 보관 위치에 있는 같은 제품(CAS 번호 또는 이름과 제조사)은 한 줄로 합쳐 보유량을 더했습니다. 유효기한은 그중 가장 이른 날짜입니다.',
            '"GHS 조회 상태"가 "확인 필요"인 줄은 앱에서 해당 시약의 유해성 정보를 아직 불러오지 않았거나 CAS 번호가 없는 경우입니다. 재고 화면에서 시약을 열어 확인하거나 SDS를 보고 직접 채우세요.',
            '주황색 머리글 열(사용량, 사용 빈도, 노출 경로, 보호구, 공학적 대책, 비고)은 연구실이 직접 판단해 작성해야 하는 항목입니다.',
            'GHS 정보는 KOSHA·PubChem 공개 자료를 바탕으로 하며, 공급사 SDS와 다를 수 있습니다. 최종 판단은 공급사 SDS와 소속 기관 지침을 따르세요.',
            '이 파일은 법정 서식을 대신하지 않습니다. 제출 서식과 보존 기간은 현행 「연구실 사전유해인자위험분석 실시에 관한 지침」과 기관 안내를 확인하세요.',
        ],
        fileName: (date: string) => `사전유해인자위험분석_화학물질목록_${date}.xlsx`,
    } satisfies RegisterSheetCopy,
};

const EN: typeof KO = {
    button: 'Hazard analysis list',
    buttonTitle: 'Download a draft chemical list for the prior hazard analysis',
    failed: 'Could not create the list file.',
    row: {
        language: 'en',
        statusLoaded: 'Classified',
        statusNotClassified: 'Not classified',
        statusNoCas: 'No CAS (check)',
        statusPending: 'Not looked up (check)',
        sdsYes: 'Stored',
        sdsNo: '',
        signalDanger: 'Danger',
        signalWarning: 'Warning',
    },
    sheet: {
        sheetName: 'Chemicals',
        guideSheetName: 'Guide',
        title: (space: string, date: string) => `Chemical holdings for the prior hazard analysis (draft) · ${space} · ${date}`,
        headers: ['No.', 'Substance', 'CAS', 'Manufacturer', 'Holding', 'Location', 'Signal word', 'Hazard statements', 'Pictograms', 'App hazard groups', 'GHS lookup', 'SDS file', 'Earliest expiry'],
        manualHeaders: ['Amount used', 'Frequency', 'Exposure routes', 'PPE', 'Engineering controls', 'Notes'],
        guide: [
            'Guide',
            'This draft is built from the inventory and GHS data in Buril Lab. Use it as the starting point for the chemical part of the prior hazard analysis.',
            'The same product (CAS number, or name and manufacturer) at one location is one row with the quantities added up. Expiry is the earliest date among them.',
            'Rows marked "check" have no GHS data loaded yet or no CAS number. Open the reagent in the inventory or fill them in from the SDS.',
            'Columns with an orange header (amount, frequency, exposure routes, PPE, controls, notes) must be judged and filled in by the lab.',
            'GHS data comes from public KOSHA and PubChem sources and may differ from the supplier SDS. The supplier SDS and your institution\'s guidance take precedence.',
            'This file does not replace the official form. Check the notice in force and your institution for the required form and retention period.',
        ],
        fileName: (date: string) => `prior-hazard-analysis-chemicals-${date}.xlsx`,
    },
};

export function hazardRegisterCopy(language: string): typeof KO {
    return language.startsWith('ko') ? KO : EN;
}
