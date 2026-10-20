import { useCallback, useEffect, useRef, type CSSProperties, type HTMLAttributes } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAdaptiveLayout } from '../hooks/useAdaptiveLayout';

interface Props extends HTMLAttributes<HTMLDivElement> {
  layout: ReturnType<typeof useAdaptiveLayout>;
  activePane?: 'primary' | 'detail';
  onBack?: () => void;
  onActivePaneChange?: (pane: 'primary' | 'detail') => void;
}

/** Children keep their identity across every resize; only their CSS placement changes. */
export function AdaptivePaneLayout({ layout: { attachContainer, twoPane, columns }, activePane = 'primary', onBack, onActivePaneChange, children, className = '', style, ...props }: Props) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    container.current = node;
    attachContainer(node);
  }, [attachContainer]);
  useEffect(() => {
    const focused = document.activeElement;
    if (twoPane || !(focused instanceof HTMLElement) || !container.current?.contains(focused)) return;
    const pane = focused.closest<HTMLElement>('[data-pane]');
    if (pane && pane.dataset.pane !== activePane) {
      const target = container.current.querySelector<HTMLElement>('.adaptive-back')
        ?? container.current.querySelector<HTMLElement>(`[data-pane="${activePane}"] button, [data-pane="${activePane}"] input`);
      target?.focus({ preventScroll: true });
    }
  }, [twoPane, activePane]);
  useEffect(() => {
    if (twoPane || activePane !== 'detail' || !onBack) return;
    const back = (event: Event) => {
      if (event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault(); onBack();
    };
    window.addEventListener('buril:adaptive-back', back);
    return () => window.removeEventListener('buril:adaptive-back', back);
  }, [twoPane, activePane, onBack]);
  return <div {...props} ref={attach} data-adaptive-wide={twoPane} data-active-pane={activePane}
    onFocusCapture={event => {
      props.onFocusCapture?.(event);
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches('input, textarea, select, [contenteditable="true"]')) return;
      const pane = target.closest<HTMLElement>('[data-pane]')?.dataset.pane;
      if (pane === 'primary' || pane === 'detail') onActivePaneChange?.(pane);
    }}
    data-hinge={Boolean(columns)} className={`adaptive-panes ${className}`}
    style={{ ...style, '--pane-columns': columns } as CSSProperties}>
    {!twoPane && activePane === 'detail' && onBack && <button type="button" className="adaptive-back"
      onClick={onBack}><ArrowLeft size={18} />{t('adaptive_back_to_list', { defaultValue: '목록으로' })}</button>}
    {children}
  </div>;
}
