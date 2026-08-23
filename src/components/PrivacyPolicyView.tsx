import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react';
import { deleteGuestSearchAnalytics, hasGuestSearchAnalytics } from '../services/searchAnalyticsService';

interface PrivacyPolicyViewProps {
    onBack: () => void;
}

export const PrivacyPolicyView: React.FC<PrivacyPolicyViewProps> = ({ onBack }) => {
    const { i18n } = useTranslation();
    const isKorean = i18n.language.startsWith('ko');

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200">
            <div className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
                <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
                    <button
                        onClick={onBack}
                        className="p-2 -ml-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-2"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        <span className="text-sm font-medium">{isKorean ? '뒤로가기' : 'Back'}</span>
                    </button>
                    <div className="font-semibold text-slate-100">
                        {isKorean ? '개인정보처리방침' : 'Privacy Policy'}
                    </div>
                    <div className="w-20" />
                </div>
            </div>

            <div className="max-w-3xl mx-auto px-6 py-12 pb-24">
                <div className="text-center mb-12">
                    <div className="text-sm text-blue-400 font-medium tracking-widest uppercase mb-2">BurilLab</div>
                    <h1 className="text-3xl font-bold text-white mb-3">
                        {isKorean ? '개인정보처리방침' : 'Privacy Policy'}
                    </h1>
                    <p className="text-sm text-slate-500">
                        {isKorean ? '최종 수정일: 2026년 8월 23일' : 'Last updated: August 23, 2026'}
                    </p>
                </div>

                {isKorean ? <KoreanPolicy /> : <EnglishPolicy />}
                <GuestAnalyticsDeletion isKorean={isKorean} />

                <div className="mt-16 pt-8 border-t border-slate-800 text-center text-slate-500 text-sm">
                    &copy; 2026 BurilLab. All rights reserved.
                </div>
            </div>
        </div>
    );
};

const Section: React.FC<{ title: string; children: React.ReactNode; id?: string }> = ({ title, children, id }) => (
    <section id={id} className="space-y-3">
        <h2 className="text-lg font-semibold text-white pl-3 border-l-4 border-blue-500">{title}</h2>
        {children}
    </section>
);

const InfoTable: React.FC<{ headers: [string, string]; rows: [string, string][] }> = ({ headers, rows }) => (
    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
        <table className="w-full text-left text-sm">
            <thead className="bg-slate-800/50 text-slate-300">
                <tr>
                    <th className="px-5 py-3 font-medium border-b border-slate-800">{headers[0]}</th>
                    <th className="px-5 py-3 font-medium border-b border-slate-800">{headers[1]}</th>
                </tr>
            </thead>
            <tbody className="text-slate-400">
                {rows.map(([label, purpose]) => (
                    <tr key={label}>
                        <td className="px-5 py-3 border-b border-slate-800/50 align-top">{label}</td>
                        <td className="px-5 py-3 border-b border-slate-800/50 align-top">{purpose}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const GuestAnalyticsDeletion: React.FC<{ isKorean: boolean }> = ({ isKorean }) => {
    const [hasData, setHasData] = useState(() => hasGuestSearchAnalytics());
    const [isDeleting, setIsDeleting] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const handleDelete = async () => {
        setIsDeleting(true);
        setMessage(null);
        const deleted = await deleteGuestSearchAnalytics();
        setIsDeleting(false);
        if (deleted) {
            setHasData(false);
            setMessage(isKorean ? '이 브라우저의 게스트 검색 분석 데이터를 삭제했습니다.' : 'Guest search analytics for this browser were deleted.');
        } else {
            setMessage(isKorean ? '삭제하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.' : 'Deletion failed. Check your connection and try again.');
        }
    };

    return (
        <section className="mt-10 space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 className="text-lg font-semibold text-white">
                {isKorean ? '게스트 검색 분석 데이터 삭제' : 'Delete Guest Search Analytics'}
            </h2>
            <p className="text-sm leading-6 text-slate-400">
                {isKorean
                    ? '로그인하지 않고 검색했다면 이 브라우저가 보관한 무작위 삭제 토큰으로 원문 이벤트와 행동을 즉시 삭제할 수 있습니다.'
                    : 'If you searched without signing in, the random deletion token held by this browser can immediately delete the raw events and actions.'}
            </p>
            <button
                type="button"
                disabled={!hasData || isDeleting}
                onClick={() => void handleDelete()}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/30 px-4 text-sm font-medium text-red-300 hover:bg-red-950/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {hasData
                    ? (isKorean ? '이 브라우저의 게스트 데이터 삭제' : 'Delete this browser’s guest data')
                    : (isKorean ? '삭제할 게스트 데이터 없음' : 'No guest data to delete')}
            </button>
            {message && <p className="text-xs text-slate-300" aria-live="polite">{message}</p>}
        </section>
    );
};

const KoreanPolicy: React.FC = () => (
    <div className="space-y-10 prose prose-invert max-w-none">
        <Section title="1. 개요">
            <p className="text-slate-400 text-[15px] leading-relaxed">
                BurilLab은 연구실 시약, 보관 위치, 폐기 기록을 관리하기 위한 서비스입니다. 이 방침은 BurilLab이
                서비스 제공을 위해 어떤 정보를 수집하고 어떻게 사용, 보관, 삭제하는지 설명합니다.
            </p>
        </Section>

        <Section title="2. 수집하는 정보">
            <p className="text-slate-400 text-[15px] leading-relaxed">
                BurilLab은 서비스 제공에 필요한 최소한의 정보를 수집합니다.
            </p>
            <InfoTable
                headers={['수집 항목', '이용 목적']}
                rows={[
                    ['이메일 주소, 계정 식별자', '회원가입, 로그인, 계정 관리, 고객 지원'],
                    ['비밀번호', 'Supabase 인증 시스템에서 해시 처리되며 원문은 BurilLab이 보관하지 않음'],
                    ['연구실, 멤버, 닉네임, 권한 정보', '공동 연구실 관리와 접근 권한 확인'],
                    ['시약, 시약장, 보관 위치, 최종 폐액 배치·구성품·처리 기록, 활동 로그', '시약 재고 관리, 보관 이력 확인, 안전 기록 유지와 검색→최종 배치 연결 분석'],
                    ['실제 제출한 정제 검색어, 검색 유형·채널, 결과 수·상태·지연시간, 최종 매칭 식별자', '검색 수요·결과 없음·기술 오류와 검색 품질 분석. 입력 중 키 입력은 수집하지 않음'],
                    ['결과 열람·선택, 10분 내 재검색, 스캔 수정, 배치 추가 행동', '혼동 원인과 검색→배치 전환 분석, 검색 별칭 개선 후보 생성'],
                    ['AI 분석 요청 내용, 스캔한 라벨 이미지', '라벨 인식과 사용자가 요청한 AI 분석 기능 제공'],
                    ['음성 질문 오디오와 전사 결과', '음성 비서 기능 제공. 음성 기능이 활성화된 경우에만 처리'],
                    ['피드백 내용, 선택 입력한 연락처, 사용자 에이전트', '버그 제보와 개선 요청 처리'],
                    ['언어, 온보딩, 안전 안내 확인 상태 등 로컬 저장 정보', '기기 내 사용 환경 유지'],
                ]}
            />
        </Section>

        <Section title="3. 정보의 이용">
            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                <li>사용자 인증, 계정 유지, 연구실 접근 권한 확인</li>
                <li>시약 검색, 재고 관리, 시약장 사진 업로드, 폐기 기록 관리</li>
                <li>AI 라벨 인식, OCR, 음성 비서 등 사용자가 요청한 기능 제공</li>
                <li>제출 검색의 수요·혼동 원인, 검색→최종 배치 전환, 배치 데이터 완성도 분석</li>
                <li>검색 별칭·자동완성·스캔 교정, 교육 우선순위와 안전규칙 검토 후보 개선</li>
                <li>보안, 오류 분석, 분석 수집 오류율 감시, API 남용 방지, 서비스 품질 개선</li>
            </ul>
        </Section>

        <Section title="4. 필수 검색·배치 분석">
            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                <li>검색 분석은 실제 검색 제출 시 필수로 적용되며, 분석 전송 실패가 검색 자체를 막지는 않습니다.</li>
                <li>검색어는 NFKC 정규화, 제어문자 제거, 200자 제한을 거치고 이메일·URL·전화번호·토큰 형태를 마스킹합니다. 유효한 CAS 번호는 시약 식별을 위해 보존합니다.</li>
                <li>게스트에게는 무작위 주체 ID와 브라우저에만 보관되는 삭제 토큰을 사용합니다. 검색 분석 목적으로 IP 주소, 브라우저 지문, 사용자 에이전트를 저장하지 않습니다.</li>
                <li>혼합 통계는 V2 최종 기록 중 무효가 아니며 사용자가 이미 혼합됨으로 확인한 배치만 사용합니다. 혼합 빈도만으로 위험성을 확정하거나 안전규칙을 자동 변경하지 않습니다.</li>
                <li>현재와 과거 데이터는 내부 서비스 개선에만 사용합니다. 개인정보를 판매하지 않으며 외부 상품은 기관 약정·재식별 위험평가·법률 검토 전까지 코드 수준에서 비활성화되어 있습니다.</li>
            </ul>
        </Section>

        <Section title="5. 제3자 처리 서비스">
            <p className="text-slate-400 text-[15px] leading-relaxed">
                BurilLab은 개인정보를 판매하지 않습니다. 다만 서비스 운영을 위해 다음 제공자를 사용할 수 있습니다.
            </p>
            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                <li>Supabase: 인증, 데이터베이스, 파일 저장소</li>
                <li>Cloudflare Pages Functions: 서버 API 실행과 요청 처리</li>
                <li>Google Gemini 및 Google Vision API: 이미지 분석, OCR, AI 응답 생성</li>
                <li>OpenAI API: 음성 전사와 음성 응답 생성 기능이 활성화된 경우</li>
                <li>Upstash Redis: API 요청 제한과 남용 방지</li>
            </ul>
        </Section>

        <Section title="6. 보관 및 삭제">
            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                <li>계정 정보와 연구실 데이터는 계정 또는 연구실이 유지되는 동안 보관됩니다.</li>
                <li>게스트 원문 검색 이벤트와 행동은 수집 후 90일에 자동 삭제되며, 이 브라우저의 삭제 토큰으로 그 전에 직접 삭제할 수 있습니다.</li>
                <li>로그인 사용자의 원문 검색 분석은 계정 유지 중 보관합니다. 최근 검색 기록 삭제 또는 회원 탈퇴 시 연결된 원문·가명 이벤트·행동을 함께 삭제합니다.</li>
                <li>삭제된 검색 이벤트를 참조한 최종 배치 구성품은 배치 기록을 유지하되 검색 연결만 제거합니다.</li>
                <li>개별 삭제 전에 최소 공개 임계치를 충족해 비가역 월간 통계로 확정된 집계만 개인 삭제 이후에도 유지될 수 있습니다.</li>
                <li>회원 탈퇴 시 개인 식별 정보와 개인 피드백 식별자는 삭제 또는 익명화됩니다.</li>
                <li>다른 멤버가 함께 사용하는 연구실 시약장, 재고, 안전 기록은 협업 연속성을 위해 유지될 수 있으며 사용자 식별자는 제거됩니다.</li>
                <li>법령상 보관이 필요한 정보가 있다면 해당 기간 동안만 보관한 뒤 삭제합니다.</li>
            </ul>
        </Section>

        <Section title="7. 계정과 데이터 삭제 방법" id="delete-account">
            <p className="text-slate-400 text-[15px] leading-relaxed">
                사용자는 언제든지 앱 안에서 직접 계정 삭제를 요청할 수 있습니다.
            </p>
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
                <ol className="list-decimal pl-5 text-slate-400 space-y-1 text-sm">
                    <li>BurilLab에 로그인합니다.</li>
                    <li>설정 화면을 엽니다.</li>
                    <li>회원 탈퇴를 선택하고 확인 문구를 입력합니다.</li>
                    <li>삭제가 완료되면 계정 접근 권한과 개인 식별 데이터가 제거됩니다.</li>
                </ol>
            </div>
            <p className="text-slate-400 text-sm">
                앱에 접근할 수 없는 경우, 가입 이메일 주소와 함께{' '}
                <a href="mailto:gudwns999999@gmail.com" className="text-blue-400">gudwns999999@gmail.com</a>
                으로 삭제를 요청할 수 있습니다. 본인 확인 후 7일 이내 처리합니다.
            </p>
        </Section>

        <Section title="8. 사용자 권리와 문의">
            <p className="text-slate-400 text-[15px] leading-relaxed">
                개인정보 열람, 정정, 삭제, 처리 중지를 요청하려면 아래 연락처로 문의해 주세요.
            </p>
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                <p className="text-slate-300 text-sm mb-2"><strong className="text-white">서비스:</strong> BurilLab</p>
                <p className="text-slate-300 text-sm m-0">
                    <strong className="text-white">이메일:</strong>{' '}
                    <a href="mailto:gudwns999999@gmail.com" className="text-blue-400 hover:text-blue-300 hover:underline">
                        gudwns999999@gmail.com
                    </a>
                </p>
            </div>
        </Section>
    </div>
);

const EnglishPolicy: React.FC = () => (
    <div className="space-y-10 prose prose-invert max-w-none">
        <Section title="1. Overview">
            <p className="text-slate-400 text-[15px] leading-relaxed">
                BurilLab is a service for managing laboratory reagents, storage locations, and disposal records.
                This policy explains what information BurilLab collects and how it is used, retained, and deleted.
            </p>
        </Section>

        <Section title="2. Information We Collect">
            <p className="text-slate-400 text-[15px] leading-relaxed">
                BurilLab collects the minimum information needed to provide the service.
            </p>
            <InfoTable
                headers={['Data', 'Purpose']}
                rows={[
                    ['Email address and account identifier', 'Sign-up, login, account management, and support'],
                    ['Password', 'Processed by Supabase authentication using hashing; BurilLab does not store the original password'],
                    ['Lab, member, nickname, and role information', 'Shared lab management and access control'],
                    ['Reagent, cabinet, storage location, final waste batch, component, handling, and activity records', 'Inventory, storage history, safety records, and search-to-final-batch linkage analysis'],
                    ['Sanitized submitted query, query type/channel, result counts/status/latency, and final matched identifiers', 'Demand, no-result, technical-error, and search quality analysis; keystrokes are not collected'],
                    ['Result open/selection, search reformulation within 10 minutes, scan correction, and add-to-batch actions', 'Confusion causes, search-to-batch conversion, and search-alias improvement candidates'],
                    ['AI request content and scanned label images', 'Label recognition, OCR, and user-requested AI analysis features'],
                    ['Voice question audio and transcription results', 'Voice assistant features, only when voice features are enabled'],
                    ['Feedback message, optional contact, and user agent', 'Bug reports and improvement requests'],
                    ['Language, onboarding, and safety acknowledgement stored locally', 'Keeping user preferences on the device'],
                ]}
            />
        </Section>

        <Section title="3. How We Use Information">
            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                <li>Authenticate users and manage lab access permissions</li>
                <li>Provide reagent search, inventory management, cabinet photo upload, and disposal records</li>
                <li>Process user-requested AI label recognition, OCR, and voice assistant features</li>
                <li>Analyze submitted-query demand, confusion causes, search-to-final-batch conversion, and batch data completeness</li>
                <li>Improve aliases, autocomplete, scan correction, training priorities, and human-reviewed safety candidates</li>
                <li>Improve service quality, monitor analytics ingestion errors, protect security, and prevent API abuse</li>
            </ul>
        </Section>

        <Section title="4. Required Search and Batch Analytics">
            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                <li>Analytics are required when a search is actually submitted. A failed analytics request does not block the search itself.</li>
                <li>Queries undergo NFKC normalization, control-character removal, a 200-character limit, and masking for email, URL, phone-number, and token patterns. Valid CAS numbers are retained for reagent identification.</li>
                <li>Guests use a random subject ID and a deletion token held only in the browser. BurilLab does not store IP addresses, browser fingerprints, or user agents for search analytics.</li>
                <li>Mixture statistics use only non-void V2 final records confirmed as already mixed. Frequency alone does not establish danger or automatically change a safety rule.</li>
                <li>Current and historical data are for internal service improvement only. BurilLab does not sell personal information, and external products remain disabled in code until institutional agreements, re-identification risk assessment, and legal review are complete.</li>
            </ul>
        </Section>

        <Section title="5. Service Providers">
            <p className="text-slate-400 text-[15px] leading-relaxed">
                BurilLab does not sell personal information. The following providers may process information to operate the service.
            </p>
            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                <li>Supabase: authentication, database, and file storage</li>
                <li>Cloudflare Pages Functions: server API execution and request handling</li>
                <li>Google Gemini and Google Vision API: image analysis, OCR, and AI response generation</li>
                <li>OpenAI API: speech transcription and spoken responses when voice features are enabled</li>
                <li>Upstash Redis: API rate limiting and abuse prevention</li>
            </ul>
        </Section>

        <Section title="6. Retention and Deletion">
            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                <li>Account and lab data are retained while the account or lab remains active.</li>
                <li>Raw guest search events and actions are automatically deleted after 90 days and can be deleted earlier with the deletion token held by this browser.</li>
                <li>Authenticated raw search analytics are retained while the account is active. Deleting recent-search history or the account also deletes linked raw and pseudonymous events and actions.</li>
                <li>If a deleted search event was linked to a final batch component, the batch remains but the search link is removed.</li>
                <li>Only irreversible monthly aggregates that met minimum release thresholds before an individual deletion may remain afterward.</li>
                <li>When an account is deleted, personally identifying account and feedback data are deleted or anonymized.</li>
                <li>Shared lab cabinets, inventory, and safety records may remain available to other lab members, with the deleted user attribution removed.</li>
                <li>Information that must be retained by law is kept only for the required period and then deleted.</li>
            </ul>
        </Section>

        <Section title="7. How to Delete Your Account and Data" id="delete-account-en">
            <p className="text-slate-400 text-[15px] leading-relaxed">
                You can request account deletion directly in the app at any time.
            </p>
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
                <ol className="list-decimal pl-5 text-slate-400 space-y-1 text-sm">
                    <li>Log in to BurilLab.</li>
                    <li>Open Settings.</li>
                    <li>Select Delete Account and enter the confirmation phrase.</li>
                    <li>After deletion, account access and personal identifiers are removed.</li>
                </ol>
            </div>
            <p className="text-slate-400 text-sm">
                If you cannot access the app, email{' '}
                <a href="mailto:gudwns999999@gmail.com" className="text-blue-400">gudwns999999@gmail.com</a>
                {' '}with your registered email address. We will process verified requests within 7 days.
            </p>
        </Section>

        <Section title="8. Your Rights and Contact">
            <p className="text-slate-400 text-[15px] leading-relaxed">
                To request access, correction, deletion, or restriction of your personal information, contact us below.
            </p>
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                <p className="text-slate-300 text-sm mb-2"><strong className="text-white">Service:</strong> BurilLab</p>
                <p className="text-slate-300 text-sm m-0">
                    <strong className="text-white">Email:</strong>{' '}
                    <a href="mailto:gudwns999999@gmail.com" className="text-blue-400 hover:text-blue-300 hover:underline">
                        gudwns999999@gmail.com
                    </a>
                </p>
            </div>
        </Section>
    </div>
);
