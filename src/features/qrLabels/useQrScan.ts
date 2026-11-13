import { useEffect, useRef } from 'react';
import jsQR from 'jsqr';

/** Longest side of the frame handed to the decoder; larger frames only cost time. */
const MAX_DECODE_SIDE = 960;
const SCAN_INTERVAL_MS = 250;

/**
 * Decodes QR codes from a live video element a few times a second.
 *
 * Decoding runs on a downscaled copy of the frame in a plain canvas, so it
 * works on every browser and in the native web view without a camera plugin.
 * The same text is reported again only after `repeatAfterMs`, so holding a
 * label in view does not flood the caller.
 */
export function useQrScan(
    getVideo: () => HTMLVideoElement | null | undefined,
    enabled: boolean,
    onText: (text: string) => void,
    options: { repeatAfterMs?: number } = {},
): void {
    const onTextRef = useRef(onText);
    const getVideoRef = useRef(getVideo);
    useEffect(() => {
        onTextRef.current = onText;
        getVideoRef.current = getVideo;
    });
    const repeatAfterMs = options.repeatAfterMs ?? 2500;

    useEffect(() => {
        if (!enabled) return;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;
        const lastSeen = new Map<string, number>();
        let stopped = false;

        const tick = () => {
            if (stopped) return;
            const video = getVideoRef.current();
            if (video && video.readyState >= 2 && video.videoWidth > 0) {
                const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(video.videoWidth, video.videoHeight));
                const width = Math.round(video.videoWidth * scale);
                const height = Math.round(video.videoHeight * scale);
                if (canvas.width !== width) canvas.width = width;
                if (canvas.height !== height) canvas.height = height;
                context.drawImage(video, 0, 0, width, height);
                const result = jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: 'dontInvert' });
                const text = result?.data?.trim();
                if (text) {
                    const now = Date.now();
                    const previous = lastSeen.get(text);
                    if (previous === undefined || now - previous >= repeatAfterMs) {
                        lastSeen.set(text, now);
                        onTextRef.current(text);
                    }
                }
            }
            timer = window.setTimeout(tick, SCAN_INTERVAL_MS);
        };
        let timer = window.setTimeout(tick, SCAN_INTERVAL_MS);
        return () => {
            stopped = true;
            window.clearTimeout(timer);
        };
    }, [enabled, repeatAfterMs]);
}
