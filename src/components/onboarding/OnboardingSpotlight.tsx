import { useEffect, useState } from 'react';

interface SpotlightRect {
    top: number;
    left: number;
    width: number;
    height: number;
}

interface OnboardingSpotlightProps {
    selector?: string;
    title: string;
    description: string;
}

export function OnboardingSpotlight({ selector, title, description }: OnboardingSpotlightProps) {
    const [rect, setRect] = useState<SpotlightRect | null>(null);

    useEffect(() => {
        if (!selector) {
            const frame = window.requestAnimationFrame(() => setRect(null));
            return () => window.cancelAnimationFrame(frame);
        }

        let frame = 0;
        let observedTarget: HTMLElement | null = null;
        const resizeObserver = new ResizeObserver(() => updateRect());
        const updateRect = () => {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(() => {
                const target = document.querySelector<HTMLElement>(selector);
                if (!target) {
                    resizeObserver.disconnect();
                    observedTarget = null;
                    setRect(null);
                    return;
                }

                if (target !== observedTarget) {
                    resizeObserver.disconnect();
                    resizeObserver.observe(target);
                    observedTarget = target;
                }

                const nextRect = target.getBoundingClientRect();
                setRect({
                    top: nextRect.top,
                    left: nextRect.left,
                    width: nextRect.width,
                    height: nextRect.height,
                });
            });
        };

        updateRect();
        window.addEventListener('resize', updateRect);
        window.addEventListener('scroll', updateRect, true);
        const mutationObserver = new MutationObserver(updateRect);
        mutationObserver.observe(document.body, { childList: true, subtree: true });

        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener('resize', updateRect);
            window.removeEventListener('scroll', updateRect, true);
            resizeObserver.disconnect();
            mutationObserver.disconnect();
        };
    }, [selector]);

    if (!rect || rect.width === 0 || rect.height === 0) {
        return null;
    }

    const padding = 8;
    const spotlightStyle = {
        top: Math.max(8, rect.top - padding),
        left: Math.max(8, rect.left - padding),
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
    };

    const tooltipTop = rect.top + rect.height + 18;
    const shouldPlaceAbove = tooltipTop > window.innerHeight - 150;
    const tooltipStyle = {
        top: shouldPlaceAbove ? Math.max(16, rect.top - 134) : tooltipTop,
        left: Math.min(Math.max(16, rect.left), window.innerWidth - 344),
    };

    return (
        <div className="pointer-events-none fixed inset-0 z-[40]">
            <div
                className="absolute rounded-2xl border-2 border-blue-500 shadow-[0_0_0_9999px_rgba(15,23,42,0.18),0_18px_42px_rgba(37,99,235,0.2)] ring-4 ring-blue-400/20 transition-all duration-300 dark:border-blue-300 dark:ring-blue-300/20"
                style={spotlightStyle}
            />
            <div
                className="absolute hidden w-[328px] rounded-2xl border border-blue-100 bg-white p-4 text-left shadow-2xl shadow-slate-950/15 dark:border-blue-900/60 dark:bg-slate-900 sm:block"
                style={tooltipStyle}
            >
                <p className="text-sm font-bold text-slate-950 dark:text-white">{title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{description}</p>
            </div>
        </div>
    );
}
