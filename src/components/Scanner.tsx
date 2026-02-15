import React, { useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { X, Loader2, Image as ImageIcon, RotateCcw, Check } from 'lucide-react';
import { performOcr } from '../services/ocrService';
import { extractCasNumber, sanitizeSearchTerm } from '../utils/textParsers';
import { useTranslation } from 'react-i18next';

interface ScannerProps {
    onScan: (text: string) => void;
    onClose: () => void;
}

type ScannerState = 'camera' | 'preview' | 'processing' | 'result';

export const Scanner: React.FC<ScannerProps> = ({ onScan, onClose }) => {
    const webcamRef = useRef<Webcam>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { t } = useTranslation();

    const [state, setState] = useState<ScannerState>('camera');
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [ocrResult, setOcrResult] = useState<{ text: string; source?: string } | null>(null);
    const [searchTerm, setSearchTerm] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showFlash, setShowFlash] = useState(false);

    const resetToCamera = useCallback(() => {
        setState('camera');
        setCapturedImage(null);
        setOcrResult(null);
        setSearchTerm(null);
        setError(null);
    }, []);

    const processImage = useCallback(async (imageSrc: string) => {
        setState('processing');
        setError(null);

        try {
            const result = await performOcr(imageSrc);
            const text = result.text;
            console.log('OCR Result:', result);

            setOcrResult(result); // Store full result including source

            const cas = extractCasNumber(text);
            if (cas) {
                setSearchTerm(cas);
                setState('result');
            } else {
                const term = sanitizeSearchTerm(text);
                if (term && term.length >= 2) {
                    setSearchTerm(term);
                    setState('result');
                } else {
                    setSearchTerm(null);
                    setError(t('scanner_error_cas'));
                    setState('result');
                }
            }
        } catch (err) {
            setError(t('scanner_error_cam'));
            console.error(err);
            setState('result');
        }
    }, [t]);

    const capture = useCallback(() => {
        console.log('[Scanner] Capture button clicked');

        // Manual capture to ensure full resolution
        const video = webcamRef.current?.video;
        if (video) {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');

            if (ctx) {
                ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
                const imageSrc = canvas.toDataURL('image/jpeg', 1.0);

                console.log(`[Scanner] Captured resolution: ${canvas.width}x${canvas.height}`);

                // Flash effect
                setShowFlash(true);
                setTimeout(() => setShowFlash(false), 150);

                setCapturedImage(imageSrc);
                setState('preview');
                return;
            }
        }

        setError(t('scanner_error_cam'));
        console.error('[Scanner] Failed to capture screenshot');
    }, [t]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                setCapturedImage(reader.result);
                setState('preview');
            }
        };
        reader.readAsDataURL(file);
    };

    const confirmAndProcess = () => {
        if (capturedImage) {
            processImage(capturedImage);
        }
    };

    const useSearchTerm = () => {
        if (searchTerm) {
            onScan(searchTerm);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col justify-center items-center">
            {/* Flash Effect */}
            {showFlash && (
                <div className="absolute inset-0 bg-white z-50 animate-pulse" />
            )}

            {/* Close Button */}
            <button
                onClick={onClose}
                className="absolute top-5 right-5 text-white/80 hover:text-white p-2 z-30"
            >
                <X className="w-8 h-8" />
            </button>

            {/* State-based Header */}
            <div className="absolute top-16 text-center text-white/90 text-sm px-4 bg-black/50 p-2 rounded z-20">
                {state === 'camera' && t('scanner_guide')}
                {state === 'preview' && '촬영된 이미지를 확인하세요'}
                {state === 'processing' && t('scanner_analyzing')}
                {state === 'result' && '인식 결과'}
            </div>

            {/* Main View Area */}
            <div className="relative w-full max-w-[430px] aspect-[3/4] bg-black overflow-hidden rounded-lg shadow-2xl">
                {/* Camera View */}
                {state === 'camera' && (
                    <>
                        <Webcam
                            audio={false}
                            ref={webcamRef}
                            screenshotFormat="image/jpeg"
                            screenshotQuality={1}
                            videoConstraints={{
                                facingMode: 'environment',
                                width: { ideal: 3840 },
                                height: { ideal: 2160 },
                            }}
                            className="w-full h-full object-cover"
                            onUserMedia={(stream) => {
                                const track = stream.getVideoTracks()[0];
                                const settings = track.getSettings();
                                console.log(`[Scanner] Camera initialized: ${settings.width}x${settings.height}`);
                                console.log('[Scanner] Full settings:', JSON.stringify(settings, null, 2));
                            }}
                            onUserMediaError={(err) => {
                                console.error('[Scanner] Camera error:', err);
                                setError(t('scanner_error_cam'));
                            }}
                        />
                        {/* Viewfinder Overlay */}
                        <div className="absolute inset-0 border-2 border-white/30 pointer-events-none flex items-center justify-center">
                            <div className="w-80 h-48 border-2 border-yellow-400/80 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"></div>
                        </div>
                    </>
                )}

                {/* Preview View */}
                {(state === 'preview' || state === 'processing' || state === 'result') && capturedImage && (
                    <img
                        src={capturedImage}
                        alt="Captured"
                        className="w-full h-full object-cover"
                    />
                )}

                {/* Processing Overlay */}
                {state === 'processing' && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white z-10">
                        <Loader2 className="w-10 h-10 animate-spin mb-2" />
                        <span>{t('scanner_analyzing')}</span>
                    </div>
                )}

                {/* Result Overlay */}
                {state === 'result' && (
                    <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white z-10 p-4">
                        <div className="bg-slate-800/90 rounded-lg p-4 max-w-full w-full max-h-[80%] overflow-auto">
                            <div className="text-xs text-slate-400 mb-2 flex justify-between items-center">
                                <span>OCR 인식 결과:</span>
                                {ocrResult?.source && (
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${ocrResult.source === 'PaddleOCR'
                                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                            : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                                        }`}>
                                        {ocrResult.source === 'PaddleOCR' ? 'High Performance (Paddle)' : 'Basic (Tesseract)'}
                                    </span>
                                )}
                            </div>
                            <div className="text-sm bg-slate-900/50 p-2 rounded mb-3 max-h-32 overflow-auto whitespace-pre-wrap break-words">
                                {ocrResult?.text || '(없음)'}
                            </div>

                            {searchTerm && (
                                <div className="mt-2">
                                    <div className="text-xs text-green-400 mb-1">검색어로 사용:</div>
                                    <div className="text-lg font-semibold text-green-300">{searchTerm}</div>
                                </div>
                            )}

                            {error && (
                                <div className="mt-2 text-red-400 text-sm">{error}</div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Footer Controls */}
            <div className="absolute bottom-10 flex flex-col items-center gap-4 w-full px-5">
                {error && state === 'camera' && (
                    <div className="bg-red-500/90 text-white px-4 py-2 rounded-lg text-sm mb-2 animate-bounce">
                        {error}
                    </div>
                )}

                {/* Camera Mode Controls */}
                {state === 'camera' && (
                    <>
                        <div className="flex items-center justify-center gap-8 w-full relative">
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                accept="image/*"
                                className="hidden"
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="p-3 bg-white/20 hover:bg-white/30 rounded-full backdrop-blur-sm transition-colors text-white"
                                title="사진 업로드"
                            >
                                <ImageIcon className="w-6 h-6" />
                            </button>

                            <button
                                onClick={capture}
                                className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-transform"
                            >
                                <div className="w-16 h-16 bg-white border-4 border-slate-300 rounded-full"></div>
                            </button>

                            <div className="w-12"></div>
                        </div>
                        <div className="text-white text-xs opacity-70">{t('scanner_capture_guide')}</div>
                    </>
                )}

                {/* Preview Mode Controls */}
                {state === 'preview' && (
                    <div className="flex items-center justify-center gap-6">
                        <button
                            onClick={resetToCamera}
                            className="flex items-center gap-2 px-5 py-3 bg-slate-600 hover:bg-slate-500 text-white rounded-full transition-colors"
                        >
                            <RotateCcw className="w-5 h-5" />
                            <span>다시 촬영</span>
                        </button>
                        <button
                            onClick={confirmAndProcess}
                            className="flex items-center gap-2 px-5 py-3 bg-green-600 hover:bg-green-500 text-white rounded-full transition-colors"
                        >
                            <Check className="w-5 h-5" />
                            <span>스캔하기</span>
                        </button>
                    </div>
                )}

                {/* Result Mode Controls */}
                {state === 'result' && (
                    <div className="flex items-center justify-center gap-4">
                        <button
                            onClick={resetToCamera}
                            className="flex items-center gap-2 px-4 py-3 bg-slate-600 hover:bg-slate-500 text-white rounded-full transition-colors"
                        >
                            <RotateCcw className="w-5 h-5" />
                            <span>다시 촬영</span>
                        </button>
                        {searchTerm && (
                            <button
                                onClick={useSearchTerm}
                                className="flex items-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-full transition-colors"
                            >
                                <Check className="w-5 h-5" />
                                <span>검색하기</span>
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
