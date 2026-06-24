import { Capacitor } from '@capacitor/core';

interface ExportFileOptions {
    fileName: string;
    mimeType: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    const chunks: string[] = [];

    for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize);
        chunks.push(String.fromCharCode(...chunk));
    }

    return btoa(chunks.join(''));
}

function sanitizeFileName(fileName: string): string {
    return fileName.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'export.xlsx';
}

function downloadBlobInBrowser(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function saveFileInNativeApp(blob: Blob, options: ExportFileOptions) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const safeFileName = sanitizeFileName(options.fileName);
    const path = `exports/${safeFileName}`;
    const savedLocation = `Documents/${path}`;
    const buffer = await blob.arrayBuffer();
    const { uri } = await Filesystem.writeFile({
        path,
        data: arrayBufferToBase64(buffer),
        directory: Directory.Documents,
        recursive: true,
    });

    window.alert(`파일을 저장했습니다.\n${savedLocation}`);
    return uri;
}

export async function exportBlobPartAsFile(
    data: BlobPart,
    options: ExportFileOptions,
): Promise<void> {
    const safeFileName = sanitizeFileName(options.fileName);
    const blob = new Blob([data], { type: options.mimeType });

    if (Capacitor.isNativePlatform()) {
        await saveFileInNativeApp(blob, { ...options, fileName: safeFileName });
        return;
    }

    downloadBlobInBrowser(blob, safeFileName);
}
