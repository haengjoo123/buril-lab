import type { TFunction } from 'i18next';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

type ContainerType = 'A' | 'B' | 'C' | 'D';

interface InventoryTemplateWorkbookOptions {
    headers: string[];
    t: TFunction;
}

interface BottleCardConfig {
    type: ContainerType;
    labelKey: string;
    modelUrl: string;
    startColumn: number;
    endColumn: number;
}

type PreviewImageMap = Record<ContainerType, string | null>;

const BOTTLE_CARD_CONFIGS: BottleCardConfig[] = [
    {
        type: 'A',
        labelKey: 'cabinet_container_amber',
        modelUrl: '/models/reagents/brown bottle.glb',
        startColumn: 1,
        endColumn: 2,
    },
    {
        type: 'B',
        labelKey: 'cabinet_container_plastic',
        modelUrl: '/models/reagents/plastic bottle.glb',
        startColumn: 3,
        endColumn: 4,
    },
    {
        type: 'C',
        labelKey: 'cabinet_container_glass',
        modelUrl: '/models/reagents/glass.glb',
        startColumn: 5,
        endColumn: 6,
    },
    {
        type: 'D',
        labelKey: 'cabinet_container_vial',
        modelUrl: '/models/reagents/square bottle.glb',
        startColumn: 7,
        endColumn: 8,
    },
];

const IMAGE_RENDER_SIZE = 240;
const SHEET_COLUMN_COUNT = 10;
const PREVIEW_SECTION_START_ROW = 3;
const PREVIEW_SECTION_END_ROW = 8;
const PREVIEW_LABEL_ROW = 9;
const GUIDE_START_ROW = 11;
const IMAGE_BORDER = {
    top: { style: 'thin', color: { argb: 'FFD7DEE8' } },
    left: { style: 'thin', color: { argb: 'FFD7DEE8' } },
    bottom: { style: 'thin', color: { argb: 'FFD7DEE8' } },
    right: { style: 'thin', color: { argb: 'FFD7DEE8' } },
} as const;

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
            BOTTLE_CARD_CONFIGS.map(async ({ type, modelUrl }) => {
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

function mergeAcrossSheet(
    worksheet: {
        mergeCells: (startRow: number, startColumn: number, endRow: number, endColumn: number) => void;
    },
    row: number,
) {
    worksheet.mergeCells(row, 1, row, SHEET_COLUMN_COUNT);
}

export async function downloadInventoryTemplateWorkbook({
    headers,
    t,
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
        { width: 15 },
        { width: 15 },
        { width: 15 },
        { width: 15 },
        { width: 18 },
        { width: 20 },
    ];

    worksheet.getRow(1).height = 24;
    worksheet.getRow(2).height = 22;
    for (let rowIndex = PREVIEW_SECTION_START_ROW; rowIndex <= PREVIEW_SECTION_END_ROW; rowIndex += 1) {
        worksheet.getRow(rowIndex).height = 22;
    }
    worksheet.getRow(PREVIEW_LABEL_ROW).height = 22;

    mergeAcrossSheet(worksheet, 1);
    const titleCell = worksheet.getCell(1, 1);
    titleCell.value = '병 종류 참고';
    titleCell.font = { bold: true, size: 14, color: { argb: 'FF0F172A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' },
    };

    mergeAcrossSheet(worksheet, 2);
    const descriptionCell = worksheet.getCell(2, 1);
    descriptionCell.value = '시약장 배치에서 사용하는 4가지 병 모양입니다. 아래 이미지를 보고 어떤 병인지 확인한 뒤 입력 예시를 수정해 주세요.';
    descriptionCell.font = { size: 10, color: { argb: 'FF475569' } };
    descriptionCell.alignment = { vertical: 'middle', horizontal: 'left' };

    BOTTLE_CARD_CONFIGS.forEach(({ type, labelKey, startColumn, endColumn }) => {
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
        labelCell.value = `${t(labelKey)} (${type})`;
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
            placeholderCell.value = t(labelKey);
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
            tl: { col: startColumn - 1 + 0.3, row: PREVIEW_SECTION_START_ROW - 1 + 0.2 },
            ext: { width: 108, height: 108 },
            editAs: 'oneCell',
        });
    });

    const guideRows = [
        `# ${t('inventory_csv_template_guide_title')}`,
        `# ${t('inventory_csv_template_guide_1')}`,
        `# ${t('inventory_csv_template_guide_2')}`,
        `# ${t('inventory_csv_template_guide_3')}`,
        `# ${t('inventory_csv_template_guide_4_other')}`,
        `# ${t('inventory_csv_template_guide_4_cabinet')}`,
        `# ${t('inventory_csv_template_guide_5')}`,
    ];

    guideRows.forEach((guideText, index) => {
        const rowNumber = GUIDE_START_ROW + index;
        worksheet.getRow(rowNumber).height = 20;
        mergeAcrossSheet(worksheet, rowNumber);
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
    mergeAcrossSheet(worksheet, inputAreaRow);
    const inputAreaCell = worksheet.getCell(inputAreaRow, 1);
    inputAreaCell.value = `# ${t('inventory_csv_template_input_area')}`;
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
        ['Acetone', 'Sigma', 'A123', '67-64-1', '1', '500mL', 'other', t('inventory_csv_template_example_location'), '2026-12-31', t('inventory_csv_template_example_memo')],
        ['Ethanol', 'Daejung', 'E100', '64-17-5', '2', '1L', 'other', t('inventory_csv_template_example_location'), '', ''],
        ['HCl', 'Junsei', 'HCL500', '7647-01-0', '1', '500mL', 'cabinet', 'A421', '', t('inventory_csv_template_example_cabinet_memo')],
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

    const workbookBuffer = await workbook.xlsx.writeBuffer();
    const workbookBytes = Uint8Array.from(workbookBuffer as unknown as ArrayLike<number>);
    downloadBufferAsFile(workbookBytes.buffer, 'inventory_import_template.xlsx');
}
