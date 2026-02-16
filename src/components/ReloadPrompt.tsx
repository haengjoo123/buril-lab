import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useTranslation } from 'react-i18next';
import { Wifi, WifiOff, RefreshCw, X } from 'lucide-react';

function ReloadPrompt() {
    const { t } = useTranslation();
    const {
        offlineReady: [offlineReady, setOfflineReady],
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegistered(r) {
            console.log('[PWA] Service Worker registered:', r);
        },
        onRegisterError(error) {
            console.error('[PWA] Service Worker registration error:', error);
        },
    });

    // Auto-hide offline ready toast after 4 seconds
    useEffect(() => {
        if (offlineReady) {
            const timer = setTimeout(() => {
                setOfflineReady(false);
            }, 4000);
            return () => clearTimeout(timer);
        }
    }, [offlineReady, setOfflineReady]);

    const close = () => {
        setOfflineReady(false);
        setNeedRefresh(false);
    };

    if (!offlineReady && !needRefresh) return null;

    return (
        <div className="fixed bottom-6 left-4 right-4 z-[9999] flex justify-center pointer-events-none">
            <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/95 backdrop-blur-xl shadow-2xl shadow-black/40 overflow-hidden animate-slide-up">
                {/* Accent bar */}
                <div className={`h-1 w-full ${needRefresh ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-gradient-to-r from-teal-400 to-cyan-500'}`} />

                <div className="p-4 flex items-start gap-3">
                    {/* Icon */}
                    <div className={`flex-shrink-0 mt-0.5 w-9 h-9 rounded-xl flex items-center justify-center ${needRefresh ? 'bg-amber-500/15 text-amber-400' : 'bg-teal-500/15 text-teal-400'}`}>
                        {needRefresh ? <RefreshCw size={18} /> : offlineReady ? <WifiOff size={18} /> : <Wifi size={18} />}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white/90 leading-snug">
                            {offlineReady ? t('pwa_offline_ready') : t('pwa_new_content')}
                        </p>

                        {needRefresh && (
                            <div className="mt-3 flex gap-2">
                                <button
                                    onClick={() => updateServiceWorker(true)}
                                    className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 transition-colors"
                                >
                                    {t('pwa_reload')}
                                </button>
                                <button
                                    onClick={close}
                                    className="px-3.5 py-1.5 text-xs font-medium rounded-lg text-white/60 hover:text-white/90 hover:bg-white/10 transition-colors"
                                >
                                    {t('pwa_close')}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Close button (for offline ready) */}
                    {offlineReady && !needRefresh && (
                        <button
                            onClick={close}
                            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default ReloadPrompt;
