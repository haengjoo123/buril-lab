import qrcode from 'qrcode-generator';

/**
 * Renders text as a QR code SVG. Error correction level M survives small
 * smudges or curved bottles; the quiet zone of four modules is part of the
 * QR specification and keeps scanners from reading neighbouring print.
 */
export function qrSvg(text: string, options: { sizePx?: number; quietZone?: number } = {}): string {
    const code = qrcode(0, 'M');
    code.addData(text, 'Byte');
    code.make();
    const count = code.getModuleCount();
    const quiet = options.quietZone ?? 4;
    const total = count + quiet * 2;
    const size = options.sizePx ?? 120;

    const cells: string[] = [];
    for (let row = 0; row < count; row += 1) {
        for (let col = 0; col < count; col += 1) {
            if (code.isDark(row, col)) cells.push(`M${col + quiet} ${row + quiet}h1v1h-1z`);
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR code">`
        + `<rect width="${total}" height="${total}" fill="#fff"/>`
        + `<path fill="#000" d="${cells.join('')}"/>`
        + '</svg>';
}

export function qrSvgDataUrl(text: string, options?: { sizePx?: number; quietZone?: number }): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(text, options))}`;
}
