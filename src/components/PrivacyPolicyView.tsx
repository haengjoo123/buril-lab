import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';

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
                        {isKorean ? '최종 수정일: 2026년 4월 24일' : 'Last updated: April 24, 2026'}
                    </p>
                </div>

                {isKorean ? <KoreanPolicy /> : <EnglishPolicy />}

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
                    ['시약, 시약장, 보관 위치, 폐기 기록, 활동 로그', '시약 재고 관리, 보관 이력 확인, 안전 기록 유지'],
                    ['검색어, AI 분석 요청 내용, 스캔한 라벨 이미지', '시약 검색, 라벨 인식, AI 분석 기능 제공'],
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
                <li>보안, 오류 분석, API 남용 방지, 서비스 품질 개선</li>
            </ul>
        </Section>

        <Section title="4. 제3자 처리 서비스">
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

        <Section title="5. 보관 및 삭제">
            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                <li>계정 정보와 연구실 데이터는 계정 또는 연구실이 유지되는 동안 보관됩니다.</li>
                <li>회원 탈퇴 시 개인 검색 기록, 개인 식별 정보, 개인 피드백 식별자는 삭제 또는 익명화됩니다.</li>
                <li>다른 멤버가 함께 사용하는 연구실 시약장, 재고, 안전 기록은 협업 연속성을 위해 유지될 수 있으며 사용자 식별자는 제거됩니다.</li>
                <li>법령상 보관이 필요한 정보가 있다면 해당 기간 동안만 보관한 뒤 삭제합니다.</li>
            </ul>
        </Section>

        <Section title="6. 계정과 데이터 삭제 방법" id="delete-account">
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

        <Section title="7. 사용자 권리와 문의">
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
                    ['Reagent, cabinet, storage location, disposal, and activity records', 'Inventory management, storage history, and safety records'],
                    ['Search queries, AI request content, and scanned label images', 'Search, label recognition, OCR, and AI analysis features'],
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
                <li>Improve service quality, investigate errors, protect security, and prevent API abuse</li>
            </ul>
        </Section>

        <Section title="4. Service Providers">
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

        <Section title="5. Retention and Deletion">
            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                <li>Account and lab data are retained while the account or lab remains active.</li>
                <li>When an account is deleted, personal search history and personally identifying account data are deleted or anonymized.</li>
                <li>Shared lab cabinets, inventory, and safety records may remain available to other lab members, with the deleted user attribution removed.</li>
                <li>Information that must be retained by law is kept only for the required period and then deleted.</li>
            </ul>
        </Section>

        <Section title="6. How to Delete Your Account and Data" id="delete-account-en">
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

        <Section title="7. Your Rights and Contact">
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
