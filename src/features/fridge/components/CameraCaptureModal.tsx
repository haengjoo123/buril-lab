import { useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { X, Check, RotateCcw, Camera, Upload, Loader2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface CameraCaptureQueueItem {
    id: string;
    imageSrc: string;
    status: 'processing' | 'success' | 'error';
    label?: string;
}

interface CameraCaptureModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCapture?: (file: File) => void;
    mode?: 'confirm' | 'continuous';
    queueItems?: CameraCaptureQueueItem[];
    onQueueCapture?: (imageSrc: string) => void;
}

export function CameraCaptureModal({
    isOpen,
    onClose,
    onCapture,
    mode = 'confirm',
    queueItems = [],
    onQueueCapture,
}: CameraCaptureModalProps) {
    const { t } = useTranslation();
    const webcamRef = useRef<Webcam>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [showFlash, setShowFlash] = useState(false);
    const isContinuous = mode === 'continuous';

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

        if (isContinuous) {
            onQueueCapture?.(capturedImage);
            setCapturedImage(null);
            return;
        }

        // Convert base64 to File object
        try {
            const res = await fetch(capturedImage);
            const blob = await res.blob();
            const file = new File([blob], `cabinet-capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
            onCapture?.(file);
            onClose();
            // Reset for next time
            setTimeout(() => setCapturedImage(null), 300);
        } catch (err) {
            console.error('Failed to convert image:', err);
            alert(t('scanner_error_cam'));
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (isContinuous && onQueueCapture) {
                const reader = new FileReader();
                reader.onload = () => onQueueCapture(reader.result as string);
                reader.onerror = () => alert(t('scanner_error_cam'));
                reader.readAsDataURL(file);
            } else {
                onCapture?.(file);
                onClose();
                // Reset for next time
                setTimeout(() => setCapturedImage(null), 300);
            }
        }
        // Reset so selecting the same file again triggers change
        e.target.value = '';
    };

    const handleDone = () => {
        if (capturedImage) {
            onQueueCapture?.(capturedImage);
        }
        onClose();
        setTimeout(() => setCapturedImage(null), 300);
    };

    const handleClose = () => {
        onClose();
        setTimeout(() => setCapturedImage(null), 300);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] bg-black flex flex-col justify-center items-center animate-in fade-in duration-200">
            {showFlash && <div className="absolute inset-0 bg-white z-[120] animate-pulse" />}

            <button
                onClick={handleClose}
                className="absolute top-5 right-5 text-white/80 hover:text-white p-2 z-[115]"
            >
                <X className="w-8 h-8" />
            </button>

            <div className="absolute top-16 text-center text-white/90 text-sm px-4 bg-black/50 p-2 rounded z-[111]">
                {capturedImage
                    ? t('cabinet_camera_check')
                    : isContinuous
                        ? t('scan_camera_capture')
                        : t('cabinet_camera_capture')}
            </div>

            {isContinuous && queueItems.length > 0 && (
                <div className="absolute left-4 bottom-32 z-[112] flex max-w-[calc(100%-2rem)] items-end gap-2 overflow-x-auto pb-1 pr-1">
                    {queueItems.slice(-5).map((item) => (
                        <div
                            key={item.id}
                            className={`scan-queue-thumb relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/40 bg-slate-900 shadow-lg shadow-black/30 ${
                                item.status === 'success' ? 'scan-queue-success' : item.status === 'error' ? 'scan-queue-error' : ''
                            }`}
                        >
                            <img src={item.imageSrc} alt="" className="h-full w-full object-cover" />
                            <div className="absolute inset-0 bg-black/10" />
                            <div className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-black bg-white text-slate-700 shadow-md">
                                {item.status === 'processing' && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />}
                                {item.status === 'success' && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                                {item.status === 'error' && <AlertCircle className="h-3.5 w-3.5 text-red-600" />}
                            </div>
                            {item.label && (
                                <div className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[9px] font-semibold text-white">
                                    {item.label}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

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
                    <img src={capturedImage} alt={t('common_captured_image_alt')} className="w-full h-full object-cover" />
                )}
            </div>

            <div className="absolute bottom-10 flex items-center justify-center gap-6 w-full px-5 z-[111]">
                {!capturedImage ? (
                    <>
                        {/* File Upload Button */}
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-14 h-14 bg-white/20 hover:bg-white/30 backdrop-blur rounded-full flex items-center justify-center transition-colors"
                            title={t('scan_upload')}
                        >
                            <Upload className="w-6 h-6 text-white" />
                        </button>

                        {/* Camera Shutter */}
                        <button
                            onClick={handleCapture}
                            className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-transform"
                        >
                            <div className="w-16 h-16 bg-white border-4 border-slate-300 rounded-full flex items-center justify-center">
                                <Camera className="w-6 h-6 text-slate-400" />
                            </div>
                        </button>

                        {/* Spacer for symmetry */}
                        <div className="w-14 h-14" />
                    </>
                ) : (
                    <>
                        <button
                            onClick={handleRetake}
                            className="flex items-center gap-1.5 px-4 py-3 bg-slate-600 hover:bg-slate-500 text-white rounded-full transition-colors"
                        >
                            <RotateCcw className="w-5 h-5" />
                            <span>{isContinuous ? t('scan_retake') : t('cabinet_camera_retake')}</span>
                        </button>
                        <button
                            onClick={handleConfirm}
                            className="flex items-center gap-1.5 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-full transition-colors"
                        >
                            <Check className="w-5 h-5" />
                            <span>{isContinuous ? t('scan_add_more') : t('cabinet_camera_use')}</span>
                        </button>
                        {isContinuous && (
                            <button
                                onClick={handleDone}
                                className="flex items-center gap-1.5 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full transition-colors"
                            >
                                <Check className="w-5 h-5" />
                                <span>{t('scan_finish')}</span>
                            </button>
                        )}
                    </>
                )}
            </div>

            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
            />
        </div>
    );
}
