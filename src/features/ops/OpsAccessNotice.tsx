import { useTranslation } from 'react-i18next'
import { Clock3, KeyRound, LogIn, RefreshCw, ShieldAlert, UserX } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { MfaSettingsPanel } from '../../components/MfaSettingsPanel'
import type { OpsAccessIssue, OpsAccessProblem } from './opsAccess'

interface OpsAccessNoticeProps {
  problem: OpsAccessProblem
  /**
   * Operator role the refused screen or action needs, e.g. "approver". Shown for a missing role and
   * for an overdue monthly review, which is kept per role.
   */
  requiredRole?: string
  /** Retry the refused request (after MFA step-up, a wait, or a role change). */
  onRetry?: () => void
  /** Inline variant for a single tab or action instead of a whole screen. */
  compact?: boolean
}

const ISSUE_COPY: Record<OpsAccessIssue, { titleKey: string; bodyKey: string; Icon: LucideIcon }> = {
  signed_out: { titleKey: 'ops_access_signed_out_title', bodyKey: 'ops_access_signed_out_body', Icon: LogIn },
  mfa_required: { titleKey: 'ops_access_mfa_title', bodyKey: 'ops_access_mfa_body', Icon: KeyRound },
  review_required: { titleKey: 'ops_access_review_title', bodyKey: 'ops_access_review_body', Icon: Clock3 },
  role_required: { titleKey: 'ops_access_role_title', bodyKey: 'ops_access_role_body', Icon: UserX },
  rate_limited: { titleKey: 'ops_access_rate_limited_title', bodyKey: 'ops_access_rate_limited_body', Icon: Clock3 },
  denied: { titleKey: 'ops_access_denied_title', bodyKey: 'ops_access_denied_body', Icon: ShieldAlert },
}

/**
 * Explains why the operator console refused a request and what fixes it.
 * MFA refusals render the step-up panel in place, so the operator never has to leave the console.
 */
export function OpsAccessNotice({ problem, requiredRole, onRetry, compact = false }: OpsAccessNoticeProps) {
  const { t } = useTranslation()
  const { titleKey, bodyKey, Icon } = ISSUE_COPY[problem.issue]
  const body = problem.issue === 'rate_limited' && problem.retryAfterSeconds
    ? t('ops_access_rate_limited_wait', { seconds: problem.retryAfterSeconds })
    : t(bodyKey)

  return (
    <div className={compact ? '' : 'p-5'}>
      <div
        role="alert"
        className={[
          'rounded-xl border border-amber-200 bg-amber-50 text-slate-900',
          compact ? 'p-4' : 'mx-auto max-w-xl p-6',
        ].join(' ')}
      >
        <div className={compact ? 'flex items-start gap-3' : 'text-center'}>
          <Icon className={compact ? 'mt-0.5 h-5 w-5 shrink-0 text-amber-700' : 'mx-auto h-9 w-9 text-amber-700'} aria-hidden="true" />
          <div className="min-w-0">
            <h2 className={compact ? 'text-sm font-semibold text-slate-950' : 'mt-3 font-semibold text-slate-950'}>{t(titleKey)}</h2>
            <p className="mt-1.5 text-sm leading-6 text-slate-700">{body}</p>
            {requiredRole && (problem.issue === 'role_required' || problem.issue === 'review_required') && (
              <p className="mt-1 text-xs font-medium text-slate-600">
                {t(problem.issue === 'review_required' ? 'ops_access_review_role' : 'ops_access_role_needed', { role: requiredRole })}
              </p>
            )}
          </div>
        </div>

        {problem.issue === 'mfa_required' && (
          <div className="mt-4 text-left">
            <MfaSettingsPanel />
          </div>
        )}

        {onRetry && problem.issue !== 'signed_out' && (
          <div className={compact ? 'mt-3' : 'mt-4 flex justify-center'}>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-amber-100"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t('ops_access_retry')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
