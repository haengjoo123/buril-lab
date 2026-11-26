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

    expect(html).toContain('최종 수정일: 2026년 11월 27일')
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

  it('discloses what agent mode sends to AI and what it records, in both languages', () => {
    const korean = renderToStaticMarkup(<PrivacyPolicyView onBack={vi.fn()} />)

    expect(korean).toContain('에이전트 모드에 입력한 문장')
    expect(korean).toContain('폐기·혼합 관련 표현이 감지된 문장은 AI로 보내지 않고')
    expect(korean).toContain('그 문장에 적힌 성분 이름만 일반 검색과 같은 물질 정보 조회에 사용')
    expect(korean).toContain('제안을 보여 준 사실과 사용자가 확인해 저장한 사실을 각각 남기며')
    expect(korean).toContain('에이전트 모드 이용 기록: 처리 경로(AI 해석·정해진 규칙), 요청 종류, 결과 상태와 사유, 응답 시간, 언어')
    expect(korean).toContain('에이전트가 처리하지 못한 요청은 입력한 문장도 저장(이메일·URL·전화번호·토큰 형태를 가리고 300자까지)')
    expect(korean).toContain('처리한 요청의 문장은 저장하지 않음')
    expect(korean).toContain('다른 사용자와 같은 연구실 멤버는 이 기록을 볼 수 없습니다')
    expect(korean).toContain('에이전트 모드에 입력한 문장의 해석(연구실 재고·기록은 보내지 않음)')
    expect(korean).toContain('구매 의도, 에이전트 모드 이용 기록은 별도 자동 삭제 기간 없이')
    // Next to the other typed and spoken requests, before feedback.
    expect(korean.indexOf('에이전트 모드에 입력한 문장')).toBeGreaterThan(korean.indexOf('음성 질문 오디오와 전사 결과'))
    expect(korean.indexOf('에이전트 모드 이용 기록:')).toBeLessThan(korean.indexOf('피드백 내용, 선택 입력한 연락처'))

    i18nState.language = 'en'
    const english = renderToStaticMarkup(<PrivacyPolicyView onBack={vi.fn()} />)

    expect(english).toContain('Sentences typed in agent mode')
    expect(english).toContain('a sentence in which disposal or mixing wording is detected is not sent to AI')
    expect(english).toContain('only the component names written in it are used for the same substance lookup as the normal search')
    expect(english).toContain('the fact that the proposal was shown and the fact that you confirmed it are each recorded')
    expect(english).toContain('Agent mode usage records: how the request was handled (AI interpretation or fixed rules), request type, result status and reason, response time, and language')
    expect(english).toContain('the typed sentence is stored as well (email, URL, phone-number, and token patterns masked, up to 300 characters)')
    expect(english).toContain('The sentence of a handled request is not stored')
    expect(english).toContain('Other users, including members of the same lab, cannot view these records')
    expect(english).toContain('interpreting sentences typed in agent mode (lab inventory and records are not sent)')
    expect(english).toContain('purchase intent, and agent mode usage records have no separate automatic deletion period')
  })

  it('keeps the English policy in step with the Korean one', () => {
    i18nState.language = 'en'
    const html = renderToStaticMarkup(<PrivacyPolicyView onBack={vi.fn()} />)

    expect(html).toContain('Last updated: November 27, 2026')
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
