import type { TFunction } from 'i18next';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
    CONTAINER_TYPE_OPTIONS,
    INVENTORY_IMPORT_HEADER_KEYS,
    getContainerTypeLabel,
    getContainerTypeOptionLabels,
    getOtherLocationOptionLabels,
} from './inventoryImportOptions';

interface InventoryTemplateWorkbookOptions {
    headers: string[];
    t: TFunction;
    cabinetNames: string[];
    cabinetPlacements?: CabinetTemplatePlacement[];
}

export interface CabinetTemplatePlacement {
    cabinetName: string;
    shelves: Array<{
        level: number;
        sectionCount: number;
    }>;
}

type PreviewImageMap = Record<(typeof CONTAINER_TYPE_OPTIONS)[number]['type'], string | null>;

const IMAGE_RENDER_SIZE = 240;
const PREVIEW_IMAGE_DISPLAY_SIZE = 132;
const PREVIEW_IMAGE_COLUMN_OFFSET = 0.37;
const PREVIEW_IMAGE_ROW_OFFSET = 0.6;
const PREVIEW_SECTION_START_ROW = 3;
const PREVIEW_SECTION_END_ROW = 8;
const PREVIEW_LABEL_ROW = 9;
const GUIDE_START_ROW = 11;
const VALIDATION_ROW_COUNT = 200;
const LIST_SHEET_NAME = '_lists';
const CABINET_POSITIONS_SHEET_NAME = '시약장_위치';
const IMAGE_BORDER = {
    top: { style: 'thin', color: { argb: 'FFD7DEE8' } },
    left: { style: 'thin', color: { argb: 'FFD7DEE8' } },
    bottom: { style: 'thin', color: { argb: 'FFD7DEE8' } },
    right: { style: 'thin', color: { argb: 'FFD7DEE8' } },
} as const;
const BOTTLE_CARD_LAYOUT = [
    { type: 'A' as const, startColumn: 1, endColumn: 2 },
    { type: 'B' as const, startColumn: 3, endColumn: 4 },
    { type: 'C' as const, startColumn: 5, endColumn: 6 },
    { type: 'D' as const, startColumn: 7, endColumn: 8 },
];

let previewImageCachePromise: Promise<PreviewImageMap> | null = null;

function setRangeFill(
    worksheet: {
        getRow: (row: number) => {
            getCell: (column: number) => {
                fill?: object;
                border?: object;
            };
        };
    },
    startRow: number,
    endRow: number,
    startColumn: number,
    endColumn: number,
    fill: object,
) {
    for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
        const row = worksheet.getRow(rowIndex);
        for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
            const cell = row.getCell(columnIndex);
            cell.fill = fill;
            cell.border = IMAGE_BORDER;
        }
    }
}

function mergeAcrossSheet(
    worksheet: {
        mergeCells: (startRow: number, startColumn: number, endRow: number, endColumn: number) => void;
    },
    row: number,
    endColumn: number,
) {
    worksheet.mergeCells(row, 1, row, endColumn);
}

function columnLetterFromIndex(columnIndex: number): string {
    let index = columnIndex;
    let result = '';

    while (index > 0) {
        const remainder = (index - 1) % 26;
        result = String.fromCharCode(65 + remainder) + result;
        index = Math.floor((index - 1) / 26);
    }

    return result;
}

function disposeRenderer(renderer: THREE.WebGLRenderer) {
    renderer.dispose();
    if (typeof renderer.forceContextLoss === 'function') {
        renderer.forceContextLoss();
    }
}

async function renderModelPreviewToPng(modelUrl: string): Promise<string> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(new URL(modelUrl, window.location.origin).toString());
    const model = gltf.scene.clone(true);

    model.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => {
            if (material instanceof THREE.MeshStandardMaterial) {
                material.transparent = false;
                material.opacity = 1;
            }
        });
    });

    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2 / maxDimension;

    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

    const scene = new THREE.Scene();
    scene.add(model);
    scene.add(new THREE.AmbientLight(0xffffff, 1));

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(3, 4, 2);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.6);
    rimLight.position.set(-2, 3, -1);
    scene.add(rimLight);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(2.3, 1, 2.3);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(IMAGE_RENDER_SIZE, IMAGE_RENDER_SIZE, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xffffff, 0);
    renderer.render(scene, camera);

    const dataUrl = renderer.domElement.toDataURL('image/png');
    disposeRenderer(renderer);
    return dataUrl;
}

async function getPreviewImages(): Promise<PreviewImageMap> {
    if (!previewImageCachePromise) {
        previewImageCachePromise = Promise.all(
            CONTAINER_TYPE_OPTIONS.map(async ({ type, modelUrl }) => {
                try {
                    const previewImage = await renderModelPreviewToPng(modelUrl);
                    return [type, previewImage] as const;
                } catch (error) {
                    console.error(`Failed to render inventory template preview for ${type}:`, error);
                    return [type, null] as const;
                }
            }),
        ).then((entries) => {
            return entries.reduce<PreviewImageMap>((accumulator, [type, previewImage]) => {
                accumulator[type] = previewImage;
                return accumulator;
            }, { A: null, B: null, C: null, D: null });
        });
    }

    return previewImageCachePromise;
}

function downloadBufferAsFile(buffer: BlobPart, filename: string) {
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

function applyTemplateLists(
    workbook: {
        addWorksheet: (name: string) => {
            state: string;
            getCell: (row: number, column: number) => { value?: unknown };
        };
        definedNames: {
            add: (range: string, name?: string) => void;
        };
    },
    t: TFunction,
    cabinetNames: string[],
    cabinetPlacements: CabinetTemplatePlacement[] = [],
) {
    const listWorksheet = workbook.addWorksheet(LIST_SHEET_NAME);
    listWorksheet.state = 'veryHidden';

    const otherLocationLabels = getOtherLocationOptionLabels(t);
    const containerLabels = getContainerTypeOptionLabels(t);
    const cabinetNameValues = cabinetNames.length > 0 ? cabinetNames : [''];
    const storageTypeValues = ['기타', '시약장'];
    const maxShelfLevel = Math.max(
        4,
        ...cabinetPlacements.flatMap((cabinet) => cabinet.shelves.map((shelf) => shelf.level + 1)),
    );
    const maxSectionCount = Math.max(
        1,
        ...cabinetPlacements.flatMap((cabinet) => cabinet.shelves.map((shelf) => shelf.sectionCount)),
    );
    const shelfLevelValues = Array.from({ length: maxShelfLevel }, (_, index) => String(index + 1));
    const shelfSectionValues = Array.from({ length: maxSectionCount }, (_, index) => String(index + 1));

    otherLocationLabels.forEach((label, index) => {
        listWorksheet.getCell(index + 1, 1).value = label;
    });
    cabinetNameValues.forEach((name, index) => {
        listWorksheet.getCell(index + 1, 2).value = name;
    });
    containerLabels.forEach((label, index) => {
        listWorksheet.getCell(index + 1, 3).value = label;
    });
    shelfLevelValues.forEach((label, index) => {
        listWorksheet.getCell(index + 1, 4).value = label;
    });
    shelfSectionValues.forEach((label, index) => {
        listWorksheet.getCell(index + 1, 5).value = label;
    });
    storageTypeValues.forEach((label, index) => {
        listWorksheet.getCell(index + 1, 6).value = label;
    });

    workbook.definedNames.add(`'${LIST_SHEET_NAME}'!$A$1:$A$${otherLocationLabels.length}`, 'other_location_options');
    workbook.definedNames.add(`'${LIST_SHEET_NAME}'!$B$1:$B$${cabinetNameValues.length}`, 'cabinet_name_options');
    workbook.definedNames.add(`'${LIST_SHEET_NAME}'!$C$1:$C$${containerLabels.length}`, 'container_type_options');
    workbook.definedNames.add(`'${LIST_SHEET_NAME}'!$D$1:$D$${shelfLevelValues.length}`, 'shelf_level_options');
    workbook.definedNames.add(`'${LIST_SHEET_NAME}'!$E$1:$E$${shelfSectionValues.length}`, 'shelf_section_options');
    workbook.definedNames.add(`'${LIST_SHEET_NAME}'!$F$1:$F$${storageTypeValues.length}`, 'storage_type_options');
}

function applyInputValidations(
    worksheet: {
        getCell: (row: number, column: number) => {
            dataValidation?: object;
        };
    },
    firstInputRow: number,
) {
    const storageTypeColumn = INVENTORY_IMPORT_HEADER_KEYS.indexOf('storage_type') + 1;
    const storageLocationColumn = INVENTORY_IMPORT_HEADER_KEYS.indexOf('storage_location') + 1;
    const shelfLevelColumn = INVENTORY_IMPORT_HEADER_KEYS.indexOf('shelf_level') + 1;
    const shelfSectionColumn = INVENTORY_IMPORT_HEADER_KEYS.indexOf('shelf_section') + 1;
    const containerTypeColumn = INVENTORY_IMPORT_HEADER_KEYS.indexOf('container_type') + 1;

    const storageTypeColumnLetter = columnLetterFromIndex(storageTypeColumn);

    for (let rowIndex = firstInputRow; rowIndex < firstInputRow + VALIDATION_ROW_COUNT; rowIndex += 1) {
        worksheet.getCell(rowIndex, storageTypeColumn).dataValidation = {
            type: 'list',
            allowBlank: false,
            showErrorMessage: true,
            showInputMessage: true,
            formulae: ['storage_type_options'],
            promptTitle: '보관유형',
            prompt: '기타 또는 시약장 중 하나를 선택하세요.',
            errorTitle: '보관유형',
            error: '보관유형은 기타 또는 시약장 중 하나여야 합니다.',
        };

        worksheet.getCell(rowIndex, storageLocationColumn).dataValidation = {
            type: 'list',
            allowBlank: false,
            showErrorMessage: true,
            showInputMessage: true,
            formulae: [`INDIRECT(IF(OR($${storageTypeColumnLetter}${rowIndex}="시약장",$${storageTypeColumnLetter}${rowIndex}="cabinet"),"cabinet_name_options","other_location_options"))`],
            promptTitle: '보관위치',
            prompt: '기타이면 냉장고/냉동고/상온보관/벤치/후드 중 선택, 시약장이면 시약장 이름을 선택하세요.',
            errorTitle: '보관위치',
            error: '보관유형에 맞는 보관위치를 목록에서 선택하세요.',
        };

        worksheet.getCell(rowIndex, shelfLevelColumn).dataValidation = {
            type: 'list',
            allowBlank: true,
            showErrorMessage: true,
            showInputMessage: true,
            formulae: ['shelf_level_options'],
            promptTitle: '선반',
            prompt: '시약장으로 등록할 때 원하는 선반 번호를 입력하세요. 비워두면 자동 배치됩니다.',
            errorTitle: '선반',
            error: '선반은 숫자 목록에서 선택하세요.',
        };

        worksheet.getCell(rowIndex, shelfSectionColumn).dataValidation = {
            type: 'list',
            allowBlank: true,
            showErrorMessage: true,
            showInputMessage: true,
            formulae: ['shelf_section_options'],
            promptTitle: '칸',
            prompt: '선반 안에서 왼쪽부터 몇 번째 칸인지 선택하세요. 비워두면 선반 전체에서 자동 배치됩니다.',
            errorTitle: '칸',
            error: '칸은 숫자 목록에서 선택하세요.',
        };

        worksheet.getCell(rowIndex, containerTypeColumn).dataValidation = {
            type: 'list',
            allowBlank: true,
            showErrorMessage: true,
            showInputMessage: true,
            formulae: ['container_type_options'],
            promptTitle: '시약병',
            prompt: '보관유형이 시약장일 때만 선택하세요. 기타이면 비워두세요.',
            errorTitle: '시약병',
            error: '시약병은 갈색병(A), 플라스틱 통(B), 유리병(C), 사각병(D) 중 하나를 선택하세요.',
        };
    }
}

export async function downloadInventoryTemplateWorkbook({
    headers,
    t,
    cabinetNames,
    cabinetPlacements = [],
}: InventoryTemplateWorkbookOptions): Promise<void> {
    const [{ Workbook }, previewImages] = await Promise.all([
        import('exceljs'),
        getPreviewImages(),
    ]);

    const workbook = new Workbook();
    workbook.creator = 'Buril Lab';
    workbook.created = new Date();
    workbook.modified = new Date();

    const worksheet = workbook.addWorksheet('Inventory_Template');
    worksheet.columns = [
        { width: 15 },
        { width: 15 },
        { width: 15 },
        { width: 15 },
        { width: 10 },
        { width: 12 },
        { width: 12 },
        { width: 18 },
        { width: 10 },
        { width: 10 },
        { width: 18 },
        { width: 14 },
        { width: 20 },
    ];

    worksheet.getRow(1).height = 24;
    worksheet.getRow(2).height = 22;
    for (let rowIndex = PREVIEW_SECTION_START_ROW; rowIndex <= PREVIEW_SECTION_END_ROW; rowIndex += 1) {
        worksheet.getRow(rowIndex).height = 22;
    }
    worksheet.getRow(PREVIEW_LABEL_ROW).height = 22;

    mergeAcrossSheet(worksheet, 1, headers.length);
    const titleCell = worksheet.getCell(1, 1);
    titleCell.value = '병 종류 참고';
    titleCell.font = { bold: true, size: 14, color: { argb: 'FF0F172A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' },
    };

    mergeAcrossSheet(worksheet, 2, headers.length);
    const descriptionCell = worksheet.getCell(2, 1);
    descriptionCell.value = '시약장 배치에 쓰는 병 4종입니다. 보관유형을 시약장으로 등록할 때는 아래 모양에 맞춰 시약병 열을 선택해 주세요.';
    descriptionCell.font = { size: 10, color: { argb: 'FF475569' } };
    descriptionCell.alignment = { vertical: 'middle', horizontal: 'left' };

    BOTTLE_CARD_LAYOUT.forEach(({ type, startColumn, endColumn }) => {
        setRangeFill(
            worksheet,
            PREVIEW_SECTION_START_ROW,
            PREVIEW_SECTION_END_ROW,
            startColumn,
            endColumn,
            {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF8FAFC' },
            },
        );

        worksheet.mergeCells(PREVIEW_LABEL_ROW, startColumn, PREVIEW_LABEL_ROW, endColumn);
        const labelCell = worksheet.getCell(PREVIEW_LABEL_ROW, startColumn);
        labelCell.value = getContainerTypeLabel(type, t);
        labelCell.font = { bold: true, size: 10, color: { argb: 'FF1E293B' } };
        labelCell.alignment = { vertical: 'middle', horizontal: 'center' };
        labelCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF1F5F9' },
        };
        labelCell.border = IMAGE_BORDER;

        const previewImage = previewImages[type];
        if (!previewImage) {
            worksheet.mergeCells(PREVIEW_SECTION_START_ROW, startColumn, PREVIEW_SECTION_END_ROW, endColumn);
            const placeholderCell = worksheet.getCell(PREVIEW_SECTION_START_ROW, startColumn);
            placeholderCell.value = getContainerTypeLabel(type, t);
            placeholderCell.alignment = {
                vertical: 'middle',
                horizontal: 'center',
            };
            placeholderCell.font = { bold: true, size: 11, color: { argb: 'FF64748B' } };
            return;
        }

        const imageId = workbook.addImage({
            base64: previewImage,
            extension: 'png',
        });

        worksheet.addImage(imageId, {
            tl: {
                col: startColumn - 1 + PREVIEW_IMAGE_COLUMN_OFFSET,
                row: PREVIEW_SECTION_START_ROW - 1 + PREVIEW_IMAGE_ROW_OFFSET,
            },
            ext: { width: PREVIEW_IMAGE_DISPLAY_SIZE, height: PREVIEW_IMAGE_DISPLAY_SIZE },
            editAs: 'oneCell',
        });
    });

    const guideRows = [
        '# [안내]',
        '# 1) 아래 "입력 영역"의 헤더와 순서를 유지해서 작성하세요.',
        '# 2) 보관유형은 기타 또는 시약장 중 하나를 선택하세요.',
        '# 3) 보관유형이 기타이면 보관위치에서 냉장고 / 냉동고 / 상온보관 / 벤치 / 후드 중 하나를 선택하세요.',
        '# 4) 보관유형이 시약장이면 보관위치에 시약장 이름을, 시약병에 병 종류를 선택하세요.',
        '# 5) 선반/칸은 시약장일 때만 입력하세요. 칸은 해당 선반에서 왼쪽부터 1, 2, 3... 순서입니다.',
        `# 6) 선반/칸을 비워두면 시약장 전체에서 자동 배치됩니다. 가능한 위치는 ${CABINET_POSITIONS_SHEET_NAME} 시트를 참고하세요.`,
        '# 7) 시약병(container_type): 갈색병(A) / 플라스틱 통(B) / 유리병(C) / 사각병(D)',
        '# 8) 유효기간 형식: YYYY-MM-DD (예: 2026-12-31), 비워도 됩니다.',
    ];

    guideRows.forEach((guideText, index) => {
        const rowNumber = GUIDE_START_ROW + index;
        worksheet.getRow(rowNumber).height = 20;
        mergeAcrossSheet(worksheet, rowNumber, headers.length);
        const cell = worksheet.getCell(rowNumber, 1);
        cell.value = guideText;
        cell.font = {
            size: 10,
            color: { argb: index === 0 ? 'FF0F172A' : 'FF475569' },
            bold: index === 0,
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        if (index === 0) {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFEEF2FF' },
            };
        }
    });

    const inputAreaRow = GUIDE_START_ROW + guideRows.length + 1;
    mergeAcrossSheet(worksheet, inputAreaRow, headers.length);
    const inputAreaCell = worksheet.getCell(inputAreaRow, 1);
    inputAreaCell.value = '# [입력 영역]';
    inputAreaCell.font = { bold: true, size: 11, color: { argb: 'FF0F172A' } };
    inputAreaCell.alignment = { vertical: 'middle', horizontal: 'left' };
    inputAreaCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDCFCE7' },
    };

    const headerRowNumber = inputAreaRow + 1;
    const headerRow = worksheet.getRow(headerRowNumber);
    headerRow.height = 24;
    headers.forEach((header, index) => {
        const cell = headerRow.getCell(index + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF0F172A' },
        };
        cell.border = IMAGE_BORDER;
    });

    const sampleRows = [
        ['Acetone', 'Sigma', 'A123', '67-64-1', '1', '500mL', '기타', String(t('loc_fridge')), '', '', '', '2026-12-31', String(t('inventory_csv_template_example_memo'))],
        ['Ethanol', 'Daejung', 'E100', '64-17-5', '2', '1L', '기타', String(t('loc_bench')), '', '', '', '', ''],
        ['HCl', 'Junsei', 'HCL500', '7647-01-0', '1', '500mL', '시약장', cabinetNames[0] || 'A421', '1', '1', getContainerTypeLabel('A', t), '', String(t('inventory_csv_template_example_cabinet_memo'))],
    ];

    sampleRows.forEach((rowValues, rowIndex) => {
        const row = worksheet.getRow(headerRowNumber + rowIndex + 1);
        row.height = 22;
        rowValues.forEach((value, columnIndex) => {
            const cell = row.getCell(columnIndex + 1);
            cell.value = value;
            cell.alignment = { vertical: 'middle', horizontal: columnIndex === 4 ? 'center' : 'left' };
            cell.border = IMAGE_BORDER;
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: rowIndex % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' },
            };
        });
    });

    applyInputValidations(worksheet, headerRowNumber + 1);
    applyTemplateLists(workbook, t, cabinetNames, cabinetPlacements);

    const referenceWorksheet = workbook.addWorksheet(CABINET_POSITIONS_SHEET_NAME);
    referenceWorksheet.columns = [
        { header: '시약장', key: 'cabinet', width: 24 },
        { header: '선반', key: 'shelf', width: 12 },
        { header: '칸', key: 'section', width: 12 },
        { header: '입력 예시', key: 'example', width: 34 },
    ];
    referenceWorksheet.getRow(1).height = 24;
    referenceWorksheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF0F172A' },
        };
        cell.border = IMAGE_BORDER;
    });

    const referenceRows = cabinetPlacements.flatMap((cabinet) =>
        cabinet.shelves.flatMap((shelf) =>
            Array.from({ length: Math.max(1, shelf.sectionCount) }, (_, sectionIndex) => [
                cabinet.cabinetName,
                `${shelf.level + 1}`,
                `${sectionIndex + 1}`,
                `${cabinet.cabinetName} / ${shelf.level + 1}층 / ${sectionIndex + 1}번 칸`,
            ]),
        ),
    );

    const rowsToAdd = referenceRows.length > 0
        ? referenceRows
        : [['등록된 시약장 없음', '', '', '']];
    rowsToAdd.forEach((values) => {
        const row = referenceWorksheet.addRow(values);
        row.eachCell((cell) => {
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
            cell.border = IMAGE_BORDER;
        });
    });

    const workbookBuffer = await workbook.xlsx.writeBuffer();
    const workbookBytes = Uint8Array.from(workbookBuffer as unknown as ArrayLike<number>);
    downloadBufferAsFile(workbookBytes.buffer, 'inventory_import_template.xlsx');
}
