import React, { useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { X, Loader2, Image as ImageIcon, RotateCcw, Check, Search } from 'lucide-react';
import { performVisionOcr, type TextBlock, type VisionOcrResult } from '../services/visionOcrService';
import { extractCasNumber } from '../utils/textParsers';
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
    const [visionResult, setVisionResult] = useState<VisionOcrResult | null>(null);
    const [selectedBlock, setSelectedBlock] = useState<number | null>(null);
    const [searchTerm, setSearchTerm] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showFlash, setShowFlash] = useState(false);

    const resetToCamera = useCallback(() => {
        setState('camera');
        setCapturedImage(null);
        setVisionResult(null);
        setSelectedBlock(null);
        setSearchTerm(null);
        setError(null);
    }, []);

    const processImage = useCallback(async (imageSrc: string) => {
        setState('processing');
        setError(null);

        try {
            const result = await performVisionOcr(imageSrc);
            console.log(`[Scanner] Vision OCR: ${result.blocks.length} blocks detected`);

            setVisionResult(result);

            // Auto-detect CAS number from full text
            const cas = extractCasNumber(result.text);
            if (cas) {
                setSearchTerm(cas);
            }

            setState('result');
        } catch (err) {
            setError(t('scanner_error_cam'));
            console.error(err);
            setState('result');
        }
    }, [t]);

    const capture = useCallback(() => {
        console.log('[Scanner] Capture button clicked');

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

    const handleBlockClick = (block: TextBlock, index: number) => {
        setSelectedBlock(index);
        // Clean up the block text for search
        const cleanText = block.text.replace(/\n/g, ' ').trim();
        setSearchTerm(cleanText);
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
                {state === 'result' && '블록을 선택하여 검색하세요'}
            </div>

            {/* Main View Area */}
            {state !== 'result' ? (
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
                    {(state === 'preview' || state === 'processing') && capturedImage && (
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
                </div>
            ) : (
                /* Result: Split View — Image with overlays + clickable blocks */
                <div className="w-full max-w-[430px] flex flex-col bg-black rounded-lg shadow-2xl overflow-hidden" style={{ maxHeight: 'calc(100vh - 140px)' }}>
                    {/* Top: Image with bounding box overlays */}
                    <div className="relative flex-shrink-0 bg-slate-950" style={{ height: '35vh', minHeight: '180px' }}>
                        {capturedImage && (
                            <img
                                src={capturedImage}
                                alt="Captured"
                                className="w-full h-full object-contain"
                            />
                        )}

                        {/* Bounding box overlays on detected blocks */}
                        {visionResult && visionResult.imageWidth > 0 && capturedImage && (
                            <div className="absolute inset-0 pointer-events-none">
                                {/* We need to calculate overlay position relative to object-contain */}
                                {visionResult.blocks.map((block, i) => {
                                    const imgW = visionResult.imageWidth;
                                    const imgH = visionResult.imageHeight;

                                    return (
                                        <div
                                            key={i}
                                            className={`absolute border-2 transition-colors ${selectedBlock === i
                                                ? 'border-blue-400 bg-blue-400/20'
                                                : 'border-green-400/60 bg-green-400/10'
                                                }`}
                                            style={{
                                                left: `${(block.boundingBox.x / imgW) * 100}%`,
                                                top: `${(block.boundingBox.y / imgH) * 100}%`,
                                                width: `${(block.boundingBox.width / imgW) * 100}%`,
                                                height: `${(block.boundingBox.height / imgH) * 100}%`,
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        )}

                        {/* Divider */}
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-blue-400/60 to-transparent"></div>
                    </div>

                    {/* Bottom: Clickable Blocks */}
                    <div className="flex-1 overflow-auto bg-slate-900 text-white" style={{ minHeight: '120px' }}>
                        {/* Header */}
                        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-sm px-4 py-2 border-b border-slate-700/50 z-10">
                            <div className="text-xs text-slate-400 flex justify-between items-center">
                                <span>인식된 블록 ({visionResult?.blocks.length || 0}개) — 탭하여 선택</span>
                                {visionResult?.source && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30">
                                        {visionResult.source}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Block list */}
                        <div className="p-3 space-y-2">
                            {visionResult?.blocks.map((block, i) => (
                                <button
                                    key={i}
                                    onClick={() => handleBlockClick(block, i)}
                                    className={`w-full text-left p-3 rounded-lg border transition-all active:scale-[0.98] ${selectedBlock === i
                                        ? 'bg-blue-600/30 border-blue-500/60 ring-1 ring-blue-400/40'
                                        : 'bg-slate-800/60 border-slate-700/40 hover:bg-slate-800 hover:border-slate-600/60'
                                        }`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1">
                                            <div className="text-[10px] text-slate-500 mb-1">Block {i + 1}</div>
                                            <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                                                {block.text}
                                            </div>
                                        </div>
                                        {selectedBlock === i && (
                                            <Check className="w-4 h-4 text-blue-400 flex-shrink-0 mt-4" />
                                        )}
                                    </div>
                                </button>
                            ))}

                            {/* CAS auto-detect notice */}
                            {searchTerm && selectedBlock === null && (
                                <div className="bg-green-900/30 border border-green-700/40 rounded-lg p-3">
                                    <div className="text-xs text-green-400 mb-1">자동 감지된 CAS 번호:</div>
                                    <div className="text-lg font-semibold text-green-300">{searchTerm}</div>
                                </div>
                            )}

                            {(!visionResult?.blocks.length && !error) && (
                                <div className="text-center text-slate-500 py-4 text-sm">
                                    인식된 텍스트가 없습니다
                                </div>
                            )}

                            {error && (
                                <div className="bg-red-900/30 border border-red-700/40 rounded-lg p-3 text-red-400 text-sm">
                                    {error}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Selected block search bar */}
                    {searchTerm !== null && (
                        <div className="flex-shrink-0 bg-slate-800 border-t border-slate-700/50 px-4 py-3 flex items-center gap-3">
                            <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="flex-1 text-sm text-white bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2 outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-400/30 placeholder-slate-500"
                                placeholder="검색어를 수정하세요"
                            />
                            <button
                                onClick={useSearchTerm}
                                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-full transition-colors font-medium flex-shrink-0"
                            >
                                <Check className="w-4 h-4" />
                                <span>검색</span>
                            </button>
                        </div>
                    )}
                </div>
            )}

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
                    </div>
                )}
            </div>
        </div>
    );
};

export default Scanner;
