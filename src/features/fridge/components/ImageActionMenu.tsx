import { Camera, Image as ImageIcon, X, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ImageActionMenuProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectCamera: () => void;
    onSelectGallery: () => void;
    hasImage?: boolean;
    onDeleteImage?: () => void;
}

export function ImageActionMenu({ isOpen, onClose, onSelectCamera, onSelectGallery, hasImage, onDeleteImage
}: ImageActionMenuProps) {
    const { t } = useTranslation();
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[105] flex items-end sm:items-center justify-center p-4 sm:p-0 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />

            <div
                className="relative bg-white dark:bg-slate-900 w-full max-w-sm rounded-t-3xl sm:rounded-2xl shadow-xl overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300 pb-6 sm:pb-0"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-lg">{t('cabinet_image_select_title')}</h3>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-2">
                    <button
                        onClick={() => { onSelectCamera(); onClose(); }}
                        className="w-full flex items-center gap-4 px-4 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-xl transition-colors text-left"
                    >
                        <div className="p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl group-hover:scale-110 transition-transform">
                            <Camera className="w-6 h-6" />
                        </div>
                        <div className="text-left flex-1">
                            <div className="font-medium text-slate-800 dark:text-slate-200 text-base">{t('cabinet_image_camera')}</div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">{t('cabinet_image_camera_desc')}</div>
                        </div>
                    </button>

                    <button
                        onClick={() => { onSelectGallery(); onClose(); }}
                        className="w-full flex items-center gap-4 px-4 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-xl transition-colors text-left"
                    >
                        <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl group-hover:scale-110 transition-transform">
                            <ImageIcon className="w-6 h-6" />
                        </div>
                        <div className="text-left flex-1">
                            <div className="font-medium text-slate-800 dark:text-slate-200 text-base">{t('cabinet_image_gallery')}</div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">{t('cabinet_image_gallery_desc')}</div>
                        </div>
                    </button>

                    {hasImage && onDeleteImage && (
                        <>
                            <div className="mx-4 border-t border-slate-100 dark:border-slate-800" />
                            <button
                                onClick={() => { onDeleteImage(); onClose(); }}
                                className="w-full flex items-center gap-4 px-4 py-4 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors text-left"
                            >
                                <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-xl">
                                    <Trash2 className="w-6 h-6" />
                                </div>
                                <div className="text-left flex-1">
                                    <div className="font-medium text-red-600 dark:text-red-400 text-base">사진 삭제</div>
                                    <div className="text-sm text-slate-500 dark:text-slate-400">현재 사진을 제거합니다</div>
                                </div>
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
