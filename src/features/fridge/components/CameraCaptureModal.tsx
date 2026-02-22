import { useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { X, Check, RotateCcw, Camera } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface CameraCaptureModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCapture: (file: File) => void;
}

export function CameraCaptureModal({ isOpen, onClose, onCapture }: CameraCaptureModalProps) {
    const { t } = useTranslation();
    const webcamRef = useRef<Webcam>(null);
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [showFlash, setShowFlash] = useState(false);

    const handleCapture = useCallback(() => {
        const imageSrc = webcamRef.current?.getScreenshot();
        if (imageSrc) {
            setShowFlash(true);
            setTimeout(() => setShowFlash(false), 150);
            setCapturedImage(imageSrc);
        }
    }, [webcamRef]);

    const handleRetake = () => {
        setCapturedImage(null);
    };

    const handleConfirm = async () => {
        if (!capturedImage) return;

        // Convert base64 to File object
        try {
            const res = await fetch(capturedImage);
            const blob = await res.blob();
            const file = new File([blob], `cabinet-capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
            onCapture(file);
            onClose();
            // Reset for next time
            setTimeout(() => setCapturedImage(null), 300);
        } catch (err) {
            console.error('Failed to convert image:', err);
            alert(t('scanner_error_cam'));
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] bg-black flex flex-col justify-center items-center animate-in fade-in duration-200">
            {showFlash && <div className="absolute inset-0 bg-white z-[120] animate-pulse" />}

            <button
                onClick={onClose}
                className="absolute top-5 right-5 text-white/80 hover:text-white p-2 z-[115]"
            >
                <X className="w-8 h-8" />
            </button>

            <div className="absolute top-16 text-center text-white/90 text-sm px-4 bg-black/50 p-2 rounded z-[111]">
                {capturedImage ? t('cabinet_camera_check') : t('cabinet_camera_capture')}
            </div>

            <div className="relative w-full max-w-[430px] aspect-[3/4] bg-black overflow-hidden rounded-lg shadow-2xl flex items-center justify-center">
                {!capturedImage ? (
                    <Webcam
                        audio={false}
                        ref={webcamRef}
                        screenshotFormat="image/jpeg"
                        videoConstraints={{
                            facingMode: 'environment',
                            width: { ideal: 1920 },
                            height: { ideal: 1080 }
                        }}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
                )}
            </div>

            <div className="absolute bottom-10 flex items-center justify-center gap-6 w-full px-5 z-[111]">
                {!capturedImage ? (
                    <button
                        onClick={handleCapture}
                        className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-transform"
                    >
                        <div className="w-16 h-16 bg-white border-4 border-slate-300 rounded-full flex items-center justify-center">
                            <Camera className="w-6 h-6 text-slate-400" />
                        </div>
                    </button>
                ) : (
                    <>
                        <button
                            onClick={handleRetake}
                            className="flex items-center gap-2 px-5 py-3 bg-slate-600 hover:bg-slate-500 text-white rounded-full transition-colors"
                        >
                            <RotateCcw className="w-5 h-5" />
                            <span>{t('cabinet_camera_retake')}</span>
                        </button>
                        <button
                            onClick={handleConfirm}
                            className="flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-full transition-colors"
                        >
                            <Check className="w-5 h-5" />
                            <span>{t('cabinet_camera_use')}</span>
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
