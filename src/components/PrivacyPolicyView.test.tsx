import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const i18nState = vi.hoisted(() => ({ language: 'ko' }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: i18nState.language },
  }),
}))

vi.mock('../services/searchAnalyticsService', () => ({
  hasGuestSearchAnalytics: () => false,
  deleteGuestSearchAnalytics: vi.fn(),
}))

import { PrivacyPolicyView } from './PrivacyPolicyView'

const sectionTitles = (html: string) =>
  Array.from(html.matchAll(/<h2[^>]*>(\d+)\. /g), (match) => Number(match[1]))

describe('PrivacyPolicyView app usage disclosure', () => {
  beforeEach(() => {
    i18nState.language = 'ko'
  })

  it('discloses server-stored onboarding, safety, and purchase intent records in Korean', () => {
    const html = renderToStaticMarkup(<PrivacyPolicyView onBack={vi.fn()} />)

    expect(html).toContain('최종 수정일: 2026년 11월 6일')
    expect(html).not.toContain('로컬 저장 정보')
    expect(html).toContain('온보딩 진행 기록')
    expect(html).toContain('검색어 원문은 저장하지 않음')
    expect(html).toContain('보관 경고 무시 기록')
    expect(html).toContain('AI 폐기 안내 열람 기록')
    expect(html).toContain('안내 요청 내용')
    expect(html).toContain('요청 내용 자체는 저장하지 않음')
    expect(html).toContain('구매 의도 기록')
    expect(html).toContain('5. 앱 이용 기록')
    expect(html).toContain('연구실을 나가도 기록의 연구실 연결은 그대로 남습니다')
    expect(html).toContain('이전 버전의 앱은 온보딩 검색 단계의 검색어 원문도 함께 저장했습니다')
    expect(sectionTitles(html)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('discloses feedback context and lab management records in Korean', () => {
    const html = renderToStaticMarkup(<PrivacyPolicyView onBack={vi.fn()} />)

    expect(html).toContain('피드백 내용, 선택 입력한 연락처, 사용자 에이전트, 보낸 화면, 연구실 공간에서 보낸 경우 그 연구실')
    expect(html).toContain('연구실 관리 기록: 멤버 가입·역할 변경·제외·나가기(대상 계정 식별자와 역할만)')
    expect(html).toContain('멤버 관련 기록은 그 연구실 관리자만, 센터 연결·현장 설정 기록은 연구실 멤버 모두 볼 수 있음')
    expect(html).toContain('개인 피드백 식별자(보낸 연구실 연결 포함)는 삭제 또는 익명화됩니다')
    // The lab management row sits right after the lab/member row.
    expect(html.indexOf('연구실 관리 기록:')).toBeGreaterThan(html.indexOf('연구실, 멤버, 닉네임, 권한 정보'))
    expect(html.indexOf('연구실 관리 기록:')).toBeLessThan(html.indexOf('시약, 시약장, 보관 위치'))
  })

  it('discloses feedback context and lab management records in English', () => {
    i18nState.language = 'en'
    const html = renderToStaticMarkup(<PrivacyPolicyView onBack={vi.fn()} />)

    expect(html).toContain('Feedback message, optional contact, user agent, the screen it was sent from, and the lab when sent from a lab space')
    expect(html).toContain('Lab management records: member joins, role changes, removals, and departures (only the account identifier and role)')
    expect(html).toContain('Member records are visible only to that lab’s admins; center link and site setting records are visible to all lab members')
    expect(html).toContain('personally identifying account and feedback data (including the lab it was sent from) are deleted or anonymized')
  })

  it('keeps the English policy in step with the Korean one', () => {
    i18nState.language = 'en'
    const html = renderToStaticMarkup(<PrivacyPolicyView onBack={vi.fn()} />)

    expect(html).toContain('Last updated: November 6, 2026')
    expect(html).not.toContain('stored locally')
    expect(html).toContain('Onboarding progress records')
    expect(html).toContain('the search text itself is not stored')
    expect(html).toContain('Ignored storage warning records')
    expect(html).toContain('AI disposal guide view records')
    expect(html).toContain('the guide request')
    expect(html).toContain('the request itself is not stored')
    expect(html).toContain('Purchase intent records')
    expect(html).toContain('5. App Usage Records')
    expect(html).toContain('the lab link stays on these records even after you leave the lab')
    expect(html).toContain('Earlier versions of the app also stored the raw text of the onboarding search')
    expect(sectionTitles(html)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})
