import React, { useRef, useState, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import { X, Loader2, Image as ImageIcon, RotateCcw, Check, Search, Sparkles } from 'lucide-react';
import { performGeminiImageAnalysis } from '../services/geminiVisionService';
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
    const [searchTerm, setSearchTerm] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showFlash, setShowFlash] = useState(false);

    // Stop all camera tracks helper
    const stopCamera = useCallback(() => {
        const video = webcamRef.current?.video;
        if (video?.srcObject) {
            const stream = video.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
    }, []);

    // Cleanup camera on unmount
    useEffect(() => {
        return () => stopCamera();
    }, [stopCamera]);

    const resetToCamera = useCallback(() => {
        setState('camera');
        setCapturedImage(null);
        setSearchTerm(null);
        setError(null);
    }, []);

    const processImage = useCallback(async (imageSrc: string) => {
        setState('processing');
        setError(null);

        try {
            const result = await performGeminiImageAnalysis(imageSrc);

            if (result.success && result.searchTerm) {
                setSearchTerm(result.searchTerm);
                setState('result');
            } else {
                setError(result.error || t('scanner_error_cam'));
                setState('result');
            }
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

            // Limit max dimension to reduce upload size and processing time
            const MAX_SIZE = 1024;
            let width = video.videoWidth;
            let height = video.videoHeight;

            if (width > height) {
                if (width > MAX_SIZE) {
                    height = Math.round((height * MAX_SIZE) / width);
                    width = MAX_SIZE;
                }
            } else {
                if (height > MAX_SIZE) {
                    width = Math.round((width * MAX_SIZE) / height);
                    height = MAX_SIZE;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            if (ctx) {
                ctx.drawImage(video, 0, 0, width, height);
                // Compress JPEG to 80% quality
                const imageSrc = canvas.toDataURL('image/jpeg', 0.8);
                console.log(`[Scanner] Captured resolution: ${width}x${height}`);

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
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_SIZE = 1024;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_SIZE) {
                            height = Math.round((height * MAX_SIZE) / width);
                            width = MAX_SIZE;
                        }
                    } else {
                        if (height > MAX_SIZE) {
                            width = Math.round((width * MAX_SIZE) / height);
                            height = MAX_SIZE;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(img, 0, 0, width, height);
                        setCapturedImage(canvas.toDataURL('image/jpeg', 0.8));
                    } else {
                        // Fallback if canvas context fails
                        setCapturedImage(reader.result as string);
                    }
                    setState('preview');
                };
                img.src = reader.result;
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
            stopCamera();
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
                onClick={() => { stopCamera(); onClose(); }}
                className="absolute top-5 right-5 text-white/80 hover:text-white p-2 z-30"
            >
                <X className="w-8 h-8" />
            </button>

            {/* State-based Header */}
            <div className="absolute top-16 text-center text-white/90 text-sm px-4 bg-black/50 p-2 rounded z-20">
                {state === 'camera' && t('scanner_guide')}
                {state === 'preview' && '촬영된 이미지를 확인하세요'}
                {state === 'processing' && ' 인식 중입니다...'}
                {state === 'result' && '검색어를 확인하세요'}
            </div>

            {/* Main View Area */}
            <div className="relative w-full max-w-[430px] aspect-[3/4] bg-black overflow-hidden rounded-lg shadow-2xl flex-shrink-0">
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

                {/* Preview / Processing / Result Image View */}
                {(state === 'preview' || state === 'processing' || state === 'result') && capturedImage && (
                    <img
                        src={capturedImage}
                        alt="Captured"
                        className={`w-full h-full object-cover transition-opacity duration-300 ${state === 'processing' ? 'opacity-50 blur-sm' : 'opacity-100'}`}
                    />
                )}

                {/* Processing Overlay */}
                {state === 'processing' && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white z-10 transition-opacity">
                        <Loader2 className="w-12 h-12 animate-spin mb-4 text-purple-400" />
                        <div className="flex items-center gap-2 text-purple-200 font-medium">
                            <Sparkles className="w-4 h-4" />
                            <span>Gemini AI 분석중...</span>
                        </div>
                    </div>
                )}

                {/* Result Overlay */}
                {state === 'result' && searchTerm && (
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-6 pt-20 flex flex-col gap-4">
                        <div className="bg-slate-900/80 backdrop-blur-md border border-purple-500/30 rounded-xl p-4 shadow-xl">
                            <div className="flex items-center gap-2 text-purple-300 text-xs mb-2 uppercase tracking-wide font-semibold">
                                <Sparkles className="w-3 h-3" />
                                <span>인식된 검색어</span>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="bg-slate-800 p-2 rounded-lg text-slate-400 border border-slate-700">
                                    <Search className="w-5 h-5" />
                                </div>
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="flex-1 text-lg font-bold text-white bg-transparent outline-none border-b border-white/20 focus:border-purple-400 focus:ring-0 pb-1"
                                    placeholder="검색어를 수정하세요"
                                />
                            </div>
                        </div>

                        <button
                            onClick={useSearchTerm}
                            className="w-full flex justify-center items-center gap-2 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl transition-colors font-bold shadow-lg shadow-purple-900/50"
                        >
                            <Check className="w-5 h-5" />
                            <span>이 검색어로 찾기</span>
                        </button>
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

                {/* Preview / Error Mode Controls */}
                {(state === 'preview' || (state === 'result' && error)) && (
                    <div className="flex items-center justify-center gap-6">
                        <button
                            onClick={resetToCamera}
                            className="flex items-center gap-2 px-5 py-3 bg-slate-600 hover:bg-slate-500 text-white rounded-full transition-colors font-medium shadow-lg"
                        >
                            <RotateCcw className="w-5 h-5" />
                            <span>다시 촬영</span>
                        </button>
                        {!error && (
                            <button
                                onClick={confirmAndProcess}
                                className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-full transition-colors font-bold shadow-lg shadow-green-900/40"
                            >
                                <Sparkles className="w-5 h-5" />
                                <span>AI 인식하기</span>
                            </button>
                        )}
                    </div>
                )}

                {/* Status Notice for error without preview logic handling it correctly */}
                {state === 'result' && error && (
                    <div className="absolute top-[-40px] bg-red-500/90 text-white px-4 py-2 rounded-lg text-sm animate-bounce w-max mx-auto left-0 right-0 text-center">
                        {error}
                    </div>
                )}

                {/* The "다시 촬영" button for result with searchTerm is now located above the input/bottom controls natively via the flex container, but actually it's better to add a small UI for it near the top left corner */}
            </div>

            {/* Top Left Retry Button for Result Mode */}
            {state === 'result' && !error && (
                <button
                    onClick={resetToCamera}
                    className="absolute top-5 left-5 text-white/80 hover:text-white p-2 z-30 bg-black/40 rounded-full backdrop-blur-md flex items-center gap-2"
                >
                    <RotateCcw className="w-4 h-4" />
                    <span className="text-xs font-medium px-1">다시 촬영</span>
                </button>
            )}
        </div>
    );
};

export default Scanner;
