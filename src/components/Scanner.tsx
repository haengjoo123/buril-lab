import React, { useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { X, Loader2, Image as ImageIcon } from 'lucide-react';
import { performOcr } from '../services/ocrService';
import { extractCasNumber } from '../utils/textParsers';
import { useTranslation } from 'react-i18next';

interface ScannerProps {
    onScan: (text: string) => void;
    onClose: () => void;
}

export const Scanner: React.FC<ScannerProps> = ({ onScan, onClose }) => {
    const webcamRef = useRef<Webcam>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { t } = useTranslation();
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const processImage = useCallback(async (imageSrc: string) => {
        setIsProcessing(true);
        setError(null);

        try {
            const text = await performOcr(imageSrc);
            console.log('OCR Result:', text);

            const cas = extractCasNumber(text);
            if (cas) {
                onScan(cas);
            } else {
                setError(t('scanner_error_cas'));
                setIsProcessing(false); // Only stop processing here if error, otherwise onScan handles unmount/update
            }
        } catch (err) {
            setError(t('scanner_error_cam'));
            console.error(err);
            setIsProcessing(false);
        }
    }, [onScan, t]);

    const capture = useCallback(() => {
        const imageSrc = webcamRef.current?.getScreenshot();
        if (imageSrc) {
            processImage(imageSrc);
        }
    }, [processImage]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                processImage(reader.result);
            }
        };
        reader.readAsDataURL(file);
    };

    return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col justify-center items-center">

            {/* Close Button */}
            <button
                onClick={onClose}
                className="absolute top-5 right-5 text-white/80 hover:text-white p-2"
            >
                <X className="w-8 h-8" />
            </button>

            {/* Warning/Guide */}
            <div className="absolute top-16 text-center text-white/90 text-sm px-4 bg-black/50 p-2 rounded">
                {t('scanner_guide')}
            </div>

            <div className="relative w-full max-w-[430px] aspect-[3/4] bg-black overflow-hidden rounded-lg shadow-2xl">
                <Webcam
                    audio={false}
                    ref={webcamRef}
                    screenshotFormat="image/jpeg"
                    videoConstraints={{ facingMode: 'environment' }}
                    className="w-full h-full object-cover"
                />

                {/* Viewfinder Overlay */}
                <div className="absolute inset-0 border-2 border-white/30 pointer-events-none flex items-center justify-center">
                    <div className="w-64 h-32 border-2 border-yellow-400/80 rounded-lg"></div>
                </div>

                {/* Processing Overlay */}
                {isProcessing && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white z-10">
                        <Loader2 className="w-10 h-10 animate-spin mb-2" />
                        <span>{t('scanner_analyzing')}</span>
                    </div>
                )}
            </div>

            {/* Footer Controls */}
            <div className="absolute bottom-10 flex flex-col items-center gap-4 w-full px-5">
                {error && (
                    <div className="bg-red-500/90 text-white px-4 py-2 rounded-lg text-sm mb-2 animate-bounce">
                        {error}
                    </div>
                )}

                <div className="flex items-center justify-center gap-8 w-full relative">
                    {/* Upload Button */}
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept="image/*"
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isProcessing}
                        className="p-3 bg-white/20 hover:bg-white/30 rounded-full backdrop-blur-sm transition-colors text-white"
                        title="사진 업로드"
                    >
                        <ImageIcon className="w-6 h-6" />
                    </button>

                    {/* Capture Button */}
                    <button
                        onClick={capture}
                        disabled={isProcessing}
                        className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-transform disabled:opacity-50"
                    >
                        <div className="w-16 h-16 bg-white border-4 border-slate-300 rounded-full"></div>
                    </button>

                    {/* Placeholder for symmetry */}
                    <div className="w-12"></div>
                </div>

                <div className="text-white text-xs opacity-70">{t('scanner_capture_guide')}</div>
            </div>

        </div>
    );
};
