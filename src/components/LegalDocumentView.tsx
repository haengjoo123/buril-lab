import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { OPERATOR_CONTACT_EMAIL } from '../config/operator';
import type { LegalDocumentKind } from '../utils/seo';

interface LegalDocumentViewProps {
    kind: LegalDocumentKind;
    onBack: () => void;
}

const TITLES: Record<LegalDocumentKind, { ko: string; en: string }> = {
    terms: { ko: '이용약관', en: 'Terms of Service' },
    cookies: { ko: '쿠키 및 브라우저 저장소 안내', en: 'Cookies & Browser Storage' },
};

export const LegalDocumentView: React.FC<LegalDocumentViewProps> = ({ kind, onBack }) => {
    const { i18n } = useTranslation();
    const isKorean = i18n.language.startsWith('ko');
    const title = TITLES[kind][isKorean ? 'ko' : 'en'];

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200">
            <div className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
                <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
                    <button
                        type="button"
                        onClick={onBack}
                        className="p-2 -ml-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-2"
                    >
                        <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                        <span className="text-sm font-medium">{isKorean ? '뒤로가기' : 'Back'}</span>
                    </button>
                    <div className="font-semibold text-slate-100">{title}</div>
                    <div className="w-20" />
                </div>
            </div>

            <main className="max-w-3xl mx-auto px-6 py-12 pb-24">
                <div className="text-center mb-12">
                    <div className="text-sm text-blue-300 font-medium tracking-widest uppercase mb-2">BurilLab</div>
                    <h1 className="text-3xl font-bold text-white mb-3">{title}</h1>
                    <p className="text-sm text-slate-400">
                        {isKorean ? '시행일: 2026년 11월 1일' : 'Effective: November 1, 2026'}
                    </p>
                </div>

                {kind === 'terms'
                    ? (isKorean ? <KoreanTerms /> : <EnglishTerms />)
                    : (isKorean ? <KoreanCookies /> : <EnglishCookies />)}

                <nav className="mt-16 pt-8 border-t border-slate-800 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-slate-400">
                    <a href="/privacy" className="hover:text-white underline underline-offset-2">{isKorean ? '개인정보처리방침' : 'Privacy Policy'}</a>
                    <a href="/terms" className="hover:text-white underline underline-offset-2">{isKorean ? '이용약관' : 'Terms of Service'}</a>
                    <a href="/cookies" className="hover:text-white underline underline-offset-2">{isKorean ? '쿠키 및 저장소 안내' : 'Cookies & Storage'}</a>
                </nav>
                <p className="mt-4 text-center text-slate-400 text-sm">&copy; 2026 BurilLab. All rights reserved.</p>
            </main>
        </div>
    );
};

const Section: React.FC<{ title: string; children: React.ReactNode; id?: string }> = ({ title, children, id }) => (
    <section id={id} className="space-y-3">
        <h2 className="text-lg font-semibold text-white pl-3 border-l-4 border-blue-500">{title}</h2>
        {children}
    </section>
);

const Paragraph: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="text-slate-300 text-[15px] leading-relaxed">{children}</p>
);

const List: React.FC<{ items: React.ReactNode[]; ordered?: boolean }> = ({ items, ordered }) => {
    const Tag = ordered ? 'ol' : 'ul';
    return (
        <Tag className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 text-slate-300 space-y-2 text-[15px]`}>
            {items.map((item, index) => <li key={index}>{item}</li>)}
        </Tag>
    );
};

const ContactEmail: React.FC = () => (
    <a href={`mailto:${OPERATOR_CONTACT_EMAIL}`} className="text-blue-300 hover:text-blue-200 underline underline-offset-2">
        {OPERATOR_CONTACT_EMAIL}
    </a>
);

const KoreanTerms: React.FC = () => (
    <div className="space-y-10">
        <Section title="1. 목적">
            <Paragraph>
                이 약관은 버릴랩(BurilLab, 이하 “서비스”)이 제공하는 연구실 폐시약 폐기 기준 검색, 시약 재고·보관 위치 관리,
                폐기 기록 및 통합안전관리센터 기능의 이용 조건과 운영자·이용자의 권리와 의무를 정합니다.
            </Paragraph>
        </Section>

        <Section title="2. 운영자 정보">
            <Paragraph>
                서비스는 현재 사업자 등록 전 단계에서 개인이 운영하고 있습니다. 사업자 등록이 완료되면 상호, 대표자,
                사업자등록번호, 사업장 주소 등 사업자 정보를 이 약관과 서비스 하단에 게시합니다.
            </Paragraph>
            <Paragraph>문의: <ContactEmail /></Paragraph>
        </Section>

        <Section title="3. 이용 자격">
            <List items={[
                '서비스는 연구실 안전관리 업무를 위한 서비스로, 만 14세 이상인 사람만 회원가입할 수 있습니다.',
                '만 14세 미만 아동은 회원가입을 할 수 없으며, 운영자는 만 14세 미만 아동의 개인정보를 알면서 수집하지 않습니다. 만 14세 미만의 가입 사실을 알게 되면 해당 계정을 삭제합니다.',
            ]} />
        </Section>

        <Section title="4. 요금 및 환불">
            <List items={[
                '현재 서비스의 모든 기능은 무료로 제공되며, 운영자는 이용자에게 결제를 받지 않습니다. 따라서 환불 대상이 되는 결제는 없습니다.',
                '향후 유료 기능을 도입하는 경우 가격, 결제 주기, 해지 및 환불 조건을 결제 전에 명확히 고지하고 이용자의 동의를 받은 뒤에만 적용합니다. 이 경우 「전자상거래 등에서의 소비자보호에 관한 법률」 등 관계 법령의 청약철회 기준을 따릅니다.',
                '무료 기능이 예고 없이 유료로 전환되어 요금이 청구되는 일은 없습니다.',
            ]} />
        </Section>

        <Section title="5. 안전 정보의 성격">
            <Paragraph>
                서비스가 보여주는 폐기 분류, GHS 주의사항, MSDS 링크, AI 라벨 인식·분류 결과는 한국산업안전보건공단(KOSHA) MSDS,
                PubChem 등 공개 자료와 AI 모델을 바탕으로 만든 참고 정보입니다.
            </Paragraph>
            <List items={[
                'AI 결과와 자동 분류는 틀릴 수 있습니다. 실제 폐기 전에는 시약의 최신 MSDS, 소속 기관의 폐기물 처리 규정, 연구실 안전관리자의 판단을 반드시 확인해 주세요.',
                '서비스는 법령상 의무 이행(예: 폐기물 관리 및 화학물질 관련 법령)이나 기관의 안전 점검을 대신하지 않습니다.',
            ]} />
        </Section>

        <Section title="6. 이용자의 의무">
            <List items={[
                '계정 정보와 비밀번호를 안전하게 관리하고, 다른 사람의 계정을 사용하지 않습니다.',
                '연구실 데이터는 사실에 맞게 입력하며, 권한 없는 연구실이나 센터 데이터에 접근하려 하지 않습니다.',
                '서비스의 정상 운영을 방해하는 자동화된 대량 요청, 보안 우회, 역설계 시도를 하지 않습니다.',
            ]} />
        </Section>

        <Section title="7. 이용자 데이터의 권리">
            <Paragraph>
                이용자와 연구실이 등록한 시약, 시약장, 폐기 기록 등의 데이터에 대한 권리는 해당 이용자 또는 연구실에 있습니다.
                운영자는 서비스 제공과 개인정보처리방침에 적힌 목적 범위에서만 데이터를 이용합니다.
            </Paragraph>
        </Section>

        <Section title="8. 서비스 변경 및 중단">
            <Paragraph>
                운영자는 기능을 개선하거나 변경할 수 있으며, 이용자에게 불리한 중요한 변경이나 서비스 종료는 최소 7일 전에
                서비스 안에서 공지합니다. 서비스를 종료하는 경우 이용자가 데이터를 내보낼 수 있는 기간을 함께 안내합니다.
            </Paragraph>
        </Section>

        <Section title="9. 회원 탈퇴와 데이터 삭제">
            <Paragraph>
                이용자는 언제든지 설정 화면에서 회원 탈퇴를 할 수 있습니다. 탈퇴와 데이터 삭제 절차는{' '}
                <a href="/privacy#delete-account" className="text-blue-300 underline underline-offset-2">개인정보처리방침</a>을 따릅니다.
            </Paragraph>
        </Section>

        <Section title="10. 책임의 제한">
            <Paragraph>
                운영자는 고의 또는 중대한 과실이 없는 한, 이용자가 5조의 확인 절차 없이 서비스의 참고 정보만으로 내린 판단이나
                천재지변·외부 제공자 장애 등 운영자가 통제할 수 없는 사유로 생긴 손해에 대해 책임을 지지 않습니다.
                다만 관계 법령상 운영자의 책임을 배제할 수 없는 경우에는 그에 따릅니다.
            </Paragraph>
        </Section>

        <Section title="11. 제3자 자산과 라이선스">
            <List items={[
                'Pretendard, Noto Sans KR 글꼴: SIL Open Font License 1.1',
                'Lucide 아이콘: ISC License',
                'GHS 그림문자: UN GHS(화학물질의 분류 및 표시에 관한 세계조화시스템) 공개 표준 그림문자',
                '3D 시약장 배경 HDRI(Potsdamer Platz, Greg Zaal / Poly Haven): CC0',
                '그 밖의 오픈소스 소프트웨어는 각 라이선스 조건에 따라 사용합니다.',
            ]} />
        </Section>

        <Section title="12. 준거법 및 약관 변경">
            <Paragraph>
                이 약관은 대한민국 법률에 따라 해석됩니다. 약관을 변경하는 경우 시행일과 변경 내용을 시행 7일 전(이용자에게 불리한 변경은 30일 전)부터
                서비스 안에서 공지합니다.
            </Paragraph>
        </Section>
    </div>
);

const EnglishTerms: React.FC = () => (
    <div className="space-y-10">
        <Section title="1. Purpose">
            <Paragraph>
                These terms govern the use of BurilLab (the “Service”): lab chemical waste disposal lookup, reagent inventory and storage
                location management, disposal records, and Safety Center features, and set out the rights and duties of the operator and users.
            </Paragraph>
        </Section>

        <Section title="2. Operator">
            <Paragraph>
                The Service is currently operated by an individual and has not yet been registered as a business. Once registered, the business
                name, representative, business registration number, and address will be published in these terms and in the site footer.
            </Paragraph>
            <Paragraph>Contact: <ContactEmail /></Paragraph>
        </Section>

        <Section title="3. Eligibility">
            <List items={[
                'The Service is intended for laboratory safety work. You must be at least 14 years old to create an account.',
                'Children under 14 may not sign up, and the operator does not knowingly collect personal information from them. Accounts found to belong to a child under 14 are deleted.',
            ]} />
        </Section>

        <Section title="4. Fees and Refunds">
            <List items={[
                'All features are currently free, and the operator does not take payments from users. There are therefore no payments subject to refund.',
                'If paid features are introduced, price, billing cycle, cancellation, and refund terms will be shown clearly before purchase and applied only with your consent, following applicable consumer protection law.',
                'Free features will not be converted into charges without notice.',
            ]} />
        </Section>

        <Section title="5. Nature of Safety Information">
            <Paragraph>
                Disposal categories, GHS precautions, MSDS links, and AI label recognition or classification results are reference information
                based on public sources such as KOSHA MSDS and PubChem together with AI models.
            </Paragraph>
            <List items={[
                'AI results and automatic classifications can be wrong. Before disposal, always check the current MSDS, your institution’s waste rules, and your lab safety officer’s judgment.',
                'The Service does not replace legal compliance obligations or institutional safety inspections.',
            ]} />
        </Section>

        <Section title="6. User Obligations">
            <List items={[
                'Keep your account credentials secure and do not use another person’s account.',
                'Enter lab data accurately and do not attempt to access labs or centers you are not authorized for.',
                'Do not send automated bulk requests, bypass security, or attempt reverse engineering that disrupts the Service.',
            ]} />
        </Section>

        <Section title="7. Rights to Your Data">
            <Paragraph>
                Reagents, cabinets, disposal records, and other data you or your lab register belong to you or your lab. The operator uses them
                only to provide the Service and for the purposes described in the Privacy Policy.
            </Paragraph>
        </Section>

        <Section title="8. Changes and Discontinuation">
            <Paragraph>
                Features may be improved or changed. Material changes that are unfavorable to users, or shutting down the Service, will be
                announced in the Service at least 7 days in advance, together with a period for exporting your data.
            </Paragraph>
        </Section>

        <Section title="9. Account Deletion">
            <Paragraph>
                You can delete your account at any time from Settings. Deletion follows the{' '}
                <a href="/privacy#delete-account-en" className="text-blue-300 underline underline-offset-2">Privacy Policy</a>.
            </Paragraph>
        </Section>

        <Section title="10. Limitation of Liability">
            <Paragraph>
                Except for intent or gross negligence, the operator is not liable for decisions made solely on the Service’s reference information
                without the checks in section 5, or for damage caused by events beyond the operator’s control such as natural disasters or
                third-party provider outages, unless applicable law provides otherwise.
            </Paragraph>
        </Section>

        <Section title="11. Third-Party Assets and Licenses">
            <List items={[
                'Pretendard and Noto Sans KR fonts: SIL Open Font License 1.1',
                'Lucide icons: ISC License',
                'GHS pictograms: public pictograms of the UN Globally Harmonized System',
                '3D cabinet HDRI (Potsdamer Platz by Greg Zaal, Poly Haven): CC0',
                'Other open-source software is used under its respective license.',
            ]} />
        </Section>

        <Section title="12. Governing Law and Changes">
            <Paragraph>
                These terms are governed by the laws of the Republic of Korea. Changes will be announced in the Service 7 days before they take
                effect, or 30 days before for changes unfavorable to users.
            </Paragraph>
        </Section>
    </div>
);

const KoreanCookies: React.FC = () => (
    <div className="space-y-10">
        <Section title="1. 광고·추적 쿠키를 사용하지 않습니다">
            <Paragraph>
                버릴랩은 광고, 리타기팅, 사이트 간 추적을 위한 쿠키나 광고 SDK를 사용하지 않습니다. 그래서 별도의 쿠키 동의 배너를
                표시하지 않습니다. 이런 쿠키를 도입하게 되면 사용 전에 이 안내를 갱신하고 선택할 수 있는 동의 절차를 마련합니다.
            </Paragraph>
        </Section>

        <Section title="2. 브라우저에 저장하는 정보">
            <Paragraph>서비스 제공에 필요한 다음 정보를 브라우저 저장소(localStorage, sessionStorage, 캐시)에 저장합니다.</Paragraph>
            <List items={[
                '로그인 세션 유지를 위한 인증 토큰',
                '언어, 화면 테마, 온보딩 진행, 안전 안내 확인 상태 등 사용 환경 설정',
                '게스트 검색 분석 데이터를 직접 삭제할 수 있게 하는 무작위 삭제 토큰(개인정보처리방침 참고)',
                '앱을 빠르게 열고 오프라인에서도 쓸 수 있게 하는 서비스 워커 캐시',
            ]} />
        </Section>

        <Section title="3. 외부 리소스">
            <Paragraph>
                화면 글꼴을 불러오기 위해 Google Fonts와 jsDelivr에 접속합니다. 이 과정에서 해당 제공자에게 IP 주소, 브라우저 정보 등
                요청에 필요한 기술 정보가 전달될 수 있습니다.
            </Paragraph>
        </Section>

        <Section title="4. 거부 및 삭제 방법">
            <List items={[
                '브라우저 설정의 “사이트 데이터 삭제” 또는 “쿠키 및 사이트 데이터” 메뉴에서 burillab.com의 저장 데이터를 지울 수 있습니다.',
                '저장 데이터를 지우면 로그아웃되고 언어·온보딩 등 설정이 초기화됩니다.',
                '브라우저 저장소를 차단하면 로그인 등 일부 기능을 사용할 수 없습니다.',
            ]} />
            <Paragraph>문의: <ContactEmail /></Paragraph>
        </Section>
    </div>
);

const EnglishCookies: React.FC = () => (
    <div className="space-y-10">
        <Section title="1. No advertising or tracking cookies">
            <Paragraph>
                BurilLab does not use cookies or SDKs for advertising, retargeting, or cross-site tracking, so no cookie consent banner is shown.
                If such cookies are ever introduced, this notice will be updated and an opt-in choice provided before they are used.
            </Paragraph>
        </Section>

        <Section title="2. What we store in your browser">
            <Paragraph>The following information is stored in browser storage (localStorage, sessionStorage, cache) to run the Service.</Paragraph>
            <List items={[
                'Authentication tokens that keep you signed in',
                'Preferences such as language, theme, onboarding progress, and safety notice acknowledgement',
                'A random deletion token that lets you delete guest search analytics yourself (see the Privacy Policy)',
                'Service worker cache that makes the app open quickly and work offline',
            ]} />
        </Section>

        <Section title="3. External resources">
            <Paragraph>
                Fonts are loaded from Google Fonts and jsDelivr. These providers may receive technical request information such as your IP
                address and browser details.
            </Paragraph>
        </Section>

        <Section title="4. How to refuse or delete">
            <List items={[
                'Clear stored data for burillab.com from your browser’s site data or cookie settings.',
                'Clearing it signs you out and resets preferences such as language and onboarding.',
                'Blocking browser storage prevents some features, such as signing in, from working.',
            ]} />
            <Paragraph>Contact: <ContactEmail /></Paragraph>
        </Section>
    </div>
);
