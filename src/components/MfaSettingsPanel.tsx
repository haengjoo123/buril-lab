import React from 'react'
import { KeyRound, Loader2, ShieldCheck, ShieldOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  beginTotpEnrollment,
  discardUnverifiedTotp,
  isCompleteTotpCode,
  loadMfaStatus,
  normalizeTotpCode,
  verifyTotpFactor,
  type MfaStatus,
  type TotpEnrollment,
} from '../services/mfaService'

export const MfaSettingsPanel: React.FC = () => {
  const { t } = useTranslation()
  const [status, setStatus] = React.useState<MfaStatus | null>(null)
  const [enrollment, setEnrollment] = React.useState<TotpEnrollment | null>(null)
  const [code, setCode] = React.useState('')
  const [isBusy, setIsBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [success, setSuccess] = React.useState('')

  const refreshStatus = React.useCallback(async () => {
    setError('')
    try {
      setStatus(await loadMfaStatus())
    } catch {
      setStatus(null)
      setError(t('settings_mfa_load_error'))
    }
  }, [t])

  React.useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const startEnrollment = async () => {
    setIsBusy(true)
    setError('')
    setSuccess('')
    try {
      setEnrollment(await beginTotpEnrollment())
      setCode('')
    } catch {
      await refreshStatus()
      setError(t('settings_mfa_start_error'))
    } finally {
      setIsBusy(false)
    }
  }

  const cancelEnrollment = async () => {
    if (!enrollment) return
    setIsBusy(true)
    setError('')
    try {
      await discardUnverifiedTotp(enrollment.factorId)
      setEnrollment(null)
      setCode('')
      await refreshStatus()
    } catch {
      setError(t('settings_mfa_cancel_error'))
    } finally {
      setIsBusy(false)
    }
  }

  const verify = async () => {
    const factorId = enrollment?.factorId ?? status?.verifiedFactorId
    if (!factorId || !isCompleteTotpCode(code)) {
      setError(t('settings_mfa_code_error'))
      return
    }

    setIsBusy(true)
    setError('')
    setSuccess('')
    try {
      await verifyTotpFactor(factorId, code)
      setEnrollment(null)
      setCode('')
      await refreshStatus()
      setSuccess(t('settings_mfa_verified'))
    } catch {
      setError(t('settings_mfa_verify_error'))
    } finally {
      setIsBusy(false)
    }
  }

  const hasVerifiedFactor = Boolean(status?.verifiedFactorId)
  const isAal2 = status?.currentLevel === 'aal2'

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60">
      <div className="flex items-start gap-3 p-3 sm:p-4">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isAal2 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
          {isAal2 ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('settings_mfa_title')}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${isAal2 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
              {isAal2 ? t('settings_mfa_aal2') : hasVerifiedFactor ? t('settings_mfa_step_up_needed') : t('settings_mfa_not_enrolled')}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {t('settings_mfa_desc')}
          </p>
        </div>
      </div>

      <div className="border-t border-slate-200 px-3 pb-3 pt-3 dark:border-slate-700 sm:px-4 sm:pb-4">
        {!status && !error && (
          <div className="flex items-center justify-center py-2 text-xs text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('dialog_processing')}
          </div>
        )}

        {status && !hasVerifiedFactor && !enrollment && (
          <button
            type="button"
            onClick={startEnrollment}
            disabled={isBusy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {t('settings_mfa_start')}
          </button>
        )}

        {enrollment && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{t('settings_mfa_scan_help')}</p>
            <div className="mx-auto w-fit rounded-xl bg-white p-2 shadow-sm">
              <img src={enrollment.qrCode} alt={t('settings_mfa_qr_alt')} className="h-44 w-44" />
            </div>
            <div className="rounded-lg bg-slate-100 p-2.5 dark:bg-slate-900">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('settings_mfa_manual_secret')}</p>
              <code className="mt-1 block break-all text-xs font-semibold tracking-wide text-slate-800 dark:text-slate-200">{enrollment.secret}</code>
              <p className="mt-1 text-[11px] text-red-500">{t('settings_mfa_secret_warning')}</p>
            </div>
            <TotpCodeInput value={code} onChange={setCode} disabled={isBusy} label={t('settings_mfa_code_label')} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={cancelEnrollment} disabled={isBusy} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-white disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                {t('btn_cancel')}
              </button>
              <button type="button" onClick={verify} disabled={isBusy || !isCompleteTotpCode(code)} className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
                {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('settings_mfa_verify')}
              </button>
            </div>
          </div>
        )}

        {status && hasVerifiedFactor && !isAal2 && !enrollment && (
          <div className="space-y-2.5">
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{t('settings_mfa_step_up_help')}</p>
            <TotpCodeInput value={code} onChange={setCode} disabled={isBusy} label={t('settings_mfa_code_label')} />
            <button type="button" onClick={verify} disabled={isBusy || !isCompleteTotpCode(code)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
              {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('settings_mfa_step_up')}
            </button>
          </div>
        )}

        {status && hasVerifiedFactor && isAal2 && (
          <p className="text-xs leading-relaxed text-emerald-700 dark:text-emerald-300">{t('settings_mfa_aal2_help')}</p>
        )}

        {error && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {error}
            {!status && (
              <button type="button" onClick={() => void refreshStatus()} className="ml-2 font-semibold underline underline-offset-2">
                {t('settings_mfa_retry')}
              </button>
            )}
          </div>
        )}
        {success && <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-300">{success}</p>}
      </div>
    </div>
  )
}

const TotpCodeInput: React.FC<{
  value: string
  onChange: (value: string) => void
  disabled: boolean
  label: string
}> = ({ value, onChange, disabled, label }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(normalizeTotpCode(event.target.value))}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      disabled={disabled}
      placeholder="000000"
      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-center font-mono text-lg tracking-[0.3em] text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-blue-900"
    />
  </label>
)
