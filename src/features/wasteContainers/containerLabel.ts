import type { WasteContainer } from '../../services/wasteContainerService';
import type { ContainerSummary } from './containerSummary';
import { formatMassMg, formatVolumeMl } from './containerSummary';
import { hazardFlagLabel, wasteStreamLabel } from '../../utils/wasteLabels';

export const LABEL_MAX_COMPONENTS = 12;

export interface ContainerLabelContext {
    language: string;
    labName: string | null;
    handlerContact: string | null;
    /** Stream prohibitions from the active waste policy. */
    prohibitions: string[];
    printedAt: Date;
    /** The deposit list behind the contents table was cut off. */
    partialContents?: boolean;
}

export interface ContainerLabelRow {
    label: string;
    value: string;
}

export interface ContainerLabelModel {
    language: 'ko' | 'en';
    heading: string;
    containerLabel: string;
    streamName: string;
    statusText: string | null;
    rows: ContainerLabelRow[];
    componentHeaders: [string, string, string, string];
    components: Array<[string, string, string, string]>;
    hiddenComponentCount: number;
    emptyComponentsText: string;
    contentsTitle: string;
    hazardsTitle: string;
    hazards: string[];
    cautionsTitle: string;
    cautions: string[];
    footer: string;
    partialNote: string | null;
    fileName: string;
}

const COPY = {
    ko: {
        heading: '폐액통 내용 기록표',
        lab: '연구실',
        location: '보관 위치',
        started: '보관 시작일',
        sealed: '봉인일',
        collected: '수거일',
        capacity: '용량',
        recorded: '기록된 투입량',
        deposits: '투입 기록',
        handler: '담당 연락처',
        printed: '출력일',
        sealedStatus: '봉인됨 — 추가 투입 금지',
        collectedStatus: '수거 완료',
        headers: ['성분', 'CAS', '투입 횟수', '기록 부피'] as [string, string, string, string],
        empty: '아직 기록된 투입이 없습니다.',
        contents: '담긴 성분',
        hazards: '위험 특성',
        noHazards: '앱에 기록된 위험 정보 없음 — 내용물을 직접 확인하세요',
        cautions: '주의사항',
        defaultCautions: [
            '다른 분류의 폐액이나 미확인 물질과 섞지 마세요.',
            '투입할 때마다 버릴랩에 기록하세요.',
            '사용하지 않을 때는 뚜껑을 닫고, 가득 채우지 말고 여유 공간을 두세요.',
        ],
        moreComponents: (count: number) => `외 ${count}종 (앱에서 전체 확인)`,
        unknownAmount: '양 미기록 투입 포함',
        approximate: '추정치 포함',
        times: (count: number) => `${count}회`,
        none: '-',
        footer: '버릴랩 투입 기록으로 만든 내용 기록표입니다. 기록하지 않은 투입은 포함되지 않습니다. 법정 지정폐기물 보관 표지를 대신하지 않으므로, 기관 지침에 따른 표지를 함께 부착하세요.',
        partial: '투입 기록이 많아 일부 기록 기준으로 작성했습니다. 전체 목록은 앱에서 확인하세요.',
        filePrefix: '폐액통_내용기록표',
    },
    en: {
        heading: 'Waste container contents record',
        lab: 'Lab',
        location: 'Location',
        started: 'Started',
        sealed: 'Sealed',
        collected: 'Collected',
        capacity: 'Capacity',
        recorded: 'Recorded volume',
        deposits: 'Deposits',
        handler: 'Contact',
        printed: 'Printed',
        sealedStatus: 'Sealed — no further deposits',
        collectedStatus: 'Collected',
        headers: ['Component', 'CAS', 'Deposits', 'Recorded volume'] as [string, string, string, string],
        empty: 'No deposits recorded yet.',
        contents: 'Contents',
        hazards: 'Hazards',
        noHazards: 'No hazard information recorded in the app — check the contents directly',
        cautions: 'Precautions',
        defaultCautions: [
            'Do not mix with other waste streams or unidentified materials.',
            'Record every deposit in Buril Lab.',
            'Keep the cap closed when not in use and leave headspace; do not overfill.',
        ],
        moreComponents: (count: number) => `+${count} more (see the app)`,
        unknownAmount: 'includes deposits without an amount',
        approximate: 'includes estimates',
        times: (count: number) => `${count}`,
        none: '-',
        footer: 'Generated from Buril Lab deposit records. Unrecorded additions are not included. This does not replace a legally required hazardous-waste label; attach the label your institution requires.',
        partial: 'Built from part of a long deposit history. See the app for the full list.',
        filePrefix: 'waste-container-contents',
    },
};

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

/** yyyy-mm-dd in local time; empty for a missing or invalid date. */
export function formatLabelDate(value: string | Date | null | undefined): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function sanitizeFileName(value: string): string {
    return value.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'container';
}

export function buildContainerLabelModel(
    container: WasteContainer,
    summary: ContainerSummary,
    context: ContainerLabelContext,
): ContainerLabelModel {
    const language = context.language.startsWith('ko') ? 'ko' : 'en';
    const copy = COPY[language];
    const rows: ContainerLabelRow[] = [];
    const push = (label: string, value: string | null | undefined) => {
        const trimmed = value?.trim();
        if (trimmed) rows.push({ label, value: trimmed });
    };

    push(copy.lab, context.labName);
    push(copy.location, container.location);
    push(copy.started, formatLabelDate(container.startedAt));
    push(copy.sealed, formatLabelDate(container.sealedAt));
    push(copy.collected, formatLabelDate(container.collectedAt));
    push(copy.capacity, container.capacityMl ? formatVolumeMl(container.capacityMl) : null);

    const amounts = [
        summary.totalMl > 0 ? formatVolumeMl(summary.totalMl) : null,
        summary.totalMg > 0 ? formatMassMg(summary.totalMg) : null,
    ].filter(Boolean).join(' + ');
    const qualifiers = [
        summary.hasUnknownAmounts ? copy.unknownAmount : null,
        summary.hasApproximateAmounts ? copy.approximate : null,
    ].filter(Boolean).join(', ');
    const fill = summary.fillRatio !== null && summary.totalMl > 0 ? ` (${Math.round(summary.fillRatio * 100)}%)` : '';
    push(copy.recorded, amounts ? `${amounts}${fill}${qualifiers ? ` · ${qualifiers}` : ''}` : (qualifiers || copy.none));
    push(copy.deposits, copy.times(summary.depositCount));
    push(copy.handler, context.handlerContact);
    push(copy.printed, formatLabelDate(context.printedAt));

    const visible = summary.components.slice(0, LABEL_MAX_COMPONENTS);
    const cautions = Array.from(new Set([
        ...context.prohibitions.map((item) => item.trim()).filter(Boolean),
        ...copy.defaultCautions,
    ]));

    return {
        language,
        heading: copy.heading,
        containerLabel: container.label,
        streamName: wasteStreamLabel(container.streamCode, language),
        statusText: container.status === 'sealed'
            ? copy.sealedStatus
            : container.status === 'collected' ? copy.collectedStatus : null,
        rows,
        componentHeaders: copy.headers,
        components: visible.map((component) => [
            component.chemicalName,
            component.casNumber ?? copy.none,
            copy.times(component.depositCount),
            component.recordedVolumeMl !== null ? formatVolumeMl(component.recordedVolumeMl) : copy.none,
        ]),
        hiddenComponentCount: summary.components.length - visible.length,
        emptyComponentsText: copy.empty,
        contentsTitle: copy.contents,
        hazardsTitle: copy.hazards,
        hazards: summary.hazardFlags.length > 0
            ? summary.hazardFlags.map((flag) => hazardFlagLabel(flag, language))
            : [copy.noHazards],
        cautionsTitle: copy.cautions,
        cautions,
        footer: copy.footer,
        partialNote: context.partialContents ? copy.partial : null,
        fileName: `${copy.filePrefix}_${sanitizeFileName(container.label)}_${formatLabelDate(context.printedAt)}.pdf`,
    };
}

type StyleMap = Partial<CSSStyleDeclaration>;

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    style: StyleMap,
    text?: string,
    children: HTMLElement[] = [],
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    Object.assign(node.style, style);
    if (text !== undefined) node.textContent = text;
    children.forEach((child) => node.appendChild(child));
    return node;
}

const INK = '#0f172a';
const MUTED = '#475569';
const RULE = '#cbd5e1';

/** Builds the printable label with text nodes only, so record text cannot inject markup. */
export function renderContainerLabelElement(model: ContainerLabelModel): HTMLElement {
    const cell = (text: string, header = false): HTMLTableCellElement => el(header ? 'th' : 'td', {
        border: `1px solid ${RULE}`,
        padding: '4px 6px',
        textAlign: 'left',
        fontWeight: header ? '700' : '400',
        background: header ? '#f1f5f9' : 'transparent',
        wordBreak: 'break-word',
    }, text);

    const infoTable = el('table', { width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginTop: '10px' });
    model.rows.forEach((row) => {
        const tr = el('tr', {});
        tr.appendChild(el('th', { width: '32%', textAlign: 'left', padding: '3px 6px 3px 0', color: MUTED, fontWeight: '600', verticalAlign: 'top' }, row.label));
        tr.appendChild(el('td', { padding: '3px 0', color: INK, verticalAlign: 'top', wordBreak: 'break-word' }, row.value));
        infoTable.appendChild(tr);
    });

    const componentSection: HTMLElement[] = [];
    if (model.components.length === 0) {
        componentSection.push(el('p', { fontSize: '11px', color: MUTED, margin: '6px 0 0' }, model.emptyComponentsText));
    } else {
        const table = el('table', { width: '100%', borderCollapse: 'collapse', fontSize: '10.5px', marginTop: '6px' });
        const head = el('tr', {});
        model.componentHeaders.forEach((header) => head.appendChild(cell(header, true)));
        table.appendChild(head);
        model.components.forEach((row) => {
            const tr = el('tr', {});
            row.forEach((value) => tr.appendChild(cell(value)));
            table.appendChild(tr);
        });
        componentSection.push(table);
    }

    const list = (items: string[]) => {
        const ul = el('ul', { margin: '4px 0 0', paddingLeft: '16px', fontSize: '11px', color: INK, listStyleType: 'disc' });
        items.forEach((item) => ul.appendChild(el('li', { margin: '2px 0' }, item)));
        return ul;
    };
    const sectionTitle = (text: string) => el('h3', { fontSize: '12px', fontWeight: '700', margin: '12px 0 0', color: INK }, text);

    const root = el('div', {
        width: '128mm',
        minHeight: '182mm',
        boxSizing: 'border-box',
        padding: '8mm',
        border: `2px solid ${INK}`,
        borderRadius: '4px',
        fontFamily: "'Pretendard', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
        color: INK,
        background: '#ffffff',
        // Korean wraps at word boundaries; long tokens (CAS, names) may still break.
        wordBreak: 'keep-all',
        overflowWrap: 'anywhere',
    });
    root.appendChild(el('p', { fontSize: '11px', letterSpacing: '0.08em', margin: '0', color: MUTED, fontWeight: '700' }, model.heading));
    root.appendChild(el('h1', { fontSize: '26px', fontWeight: '800', margin: '4px 0 0', lineHeight: '1.2', wordBreak: 'break-word' }, model.containerLabel));
    root.appendChild(el('h2', { fontSize: '15px', margin: '4px 0 0', fontWeight: '700' }, model.streamName));
    if (model.statusText) {
        root.appendChild(el('p', {
            display: 'inline-block', margin: '8px 0 0', padding: '3px 8px', fontSize: '11px', fontWeight: '700',
            border: `1.5px solid ${INK}`, borderRadius: '3px',
        }, model.statusText));
    }
    root.appendChild(infoTable);
    root.appendChild(sectionTitle(model.contentsTitle));
    componentSection.forEach((node) => root.appendChild(node));
    if (model.hiddenComponentCount > 0) {
        root.appendChild(el('p', { fontSize: '10px', color: MUTED, margin: '4px 0 0' }, hiddenComponentsText(model)));
    }
    if (model.partialNote) {
        root.appendChild(el('p', { fontSize: '10px', color: MUTED, margin: '4px 0 0' }, model.partialNote));
    }
    root.appendChild(sectionTitle(model.hazardsTitle));
    root.appendChild(list(model.hazards));
    root.appendChild(sectionTitle(model.cautionsTitle));
    root.appendChild(list(model.cautions));
    root.appendChild(el('p', { fontSize: '9px', color: MUTED, margin: '12px 0 0', lineHeight: '1.45' }, model.footer));
    return root;
}

export function hiddenComponentsText(model: Pick<ContainerLabelModel, 'language' | 'hiddenComponentCount'>): string {
    return COPY[model.language].moreComponents(model.hiddenComponentCount);
}

/** Renders the label off-screen and saves an A5 PDF, like the waste-log export. */
export async function downloadContainerLabelPdf(model: ContainerLabelModel): Promise<void> {
    const html2pdf = (await import('html2pdf.js')).default;
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', background: '#ffffff' });
    host.appendChild(renderContainerLabelElement(model));
    document.body.appendChild(host);
    try {
        await html2pdf().set({
            margin: 10,
            filename: model.fileName,
            image: { type: 'jpeg' as const, quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
            jsPDF: { unit: 'mm' as const, format: 'a5' as const, orientation: 'portrait' as const },
        }).from(host.firstElementChild as HTMLElement).save();
    } finally {
        host.remove();
    }
}
