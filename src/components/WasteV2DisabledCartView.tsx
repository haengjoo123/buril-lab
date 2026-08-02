import { AlertTriangle, ClipboardList, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWasteStore } from '../store/useWasteStore'
import { checkCompatibility } from '../utils/compatibilityChecker'

interface WasteV2DisabledCartViewProps {
  onClose: () => void
  onOpenLogs?: () => void
}

/**
 * Fail-safe rollback surface used when the V2 database/UI rollout flag is off.
 * It preserves the scoped draft and legacy lookup experience, but intentionally
 * performs no direct waste_logs mutation because the P0 migration revokes it.
 */
export function WasteV2DisabledCartView({
  onClose,
  onOpenLogs,
}: WasteV2DisabledCartViewProps) {
  const { t } = useTranslation()
  const cart = useWasteStore((state) => state.cart)
  const removeFromCart = useWasteStore((state) => state.removeFromCart)
  const clearCart = useWasteStore((state) => state.clearCart)
  const warnings = checkCompatibility(cart)

  const clearDraft = () => {
    if (cart.length === 0 || window.confirm(t('cart_confirm_clear'))) clearCart()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-stretch lg:justify-end">
      <button className="absolute inset-0 bg-black/50" onClick={onClose} aria-label={t('close')} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="waste-rollout-guard-title"
        className="relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-950 lg:h-full lg:max-h-none lg:w-[440px] lg:rounded-none lg:border-l lg:border-slate-800"
      >
        <header className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
          <div>
            <h2 id="waste-rollout-guard-title" className="font-bold text-slate-950 dark:text-white">
              {t('cart_title')} <span className="text-blue-600">({cart.length})</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">{t('waste_v2_rollout_disabled_title')}</p>
          </div>
          <button onClick={onClose} aria-label={t('close')} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm leading-6 text-orange-950 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100" role="status">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-bold">{t('waste_v2_rollout_disabled_title')}</p>
                <p className="mt-1">{t('waste_v2_rollout_disabled_body')}</p>
              </div>
            </div>
          </div>

          {cart.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
              {t('cart_empty')}
            </p>
          ) : (
            <div className="space-y-2">
              {cart.map((item) => (
                <article key={item.cartLineId} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-slate-900 dark:text-white">{item.chemical.name}</h3>
                    <p className="mt-1 text-xs text-slate-500">{item.chemical.casNumber ? `CAS ${item.chemical.casNumber}` : t(item.label as never)}</p>
                  </div>
                  <button
                    onClick={() => removeFromCart(item.cartLineId)}
                    aria-label={`${t('log_delete')} ${item.chemical.name}`}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </article>
              ))}
            </div>
          )}

          {warnings.length > 0 && (
            <section className="rounded-2xl bg-slate-50 p-4 text-sm dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">{t('compat_title')}</p>
              {warnings.map((warning) => (
                <p key={warning.ruleId} className="mt-2 text-red-700 dark:text-red-300">
                  {warning.chemicalA} + {warning.chemicalB}: {t(warning.messageKey as never)}
                </p>
              ))}
            </section>
          )}
        </main>

        <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-200 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:border-slate-800">
          <button onClick={clearDraft} disabled={cart.length === 0} className="min-h-11 rounded-xl border border-slate-300 px-3 font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">
            {t('btn_clear_all')}
          </button>
          <button
            onClick={() => {
              onClose()
              onOpenLogs?.()
            }}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 font-semibold text-white"
          >
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            {t('waste_receipt_view')}
          </button>
        </footer>
      </div>
    </div>
  )
}
