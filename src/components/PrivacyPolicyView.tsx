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
            {/* Header / Nav */}
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
                    {/* Placeholder to balance the flex layout */}
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
                        {isKorean ? '최종 수정일: 2026년 4월 3일' : 'Last updated: April 3, 2026'}
                    </p>
                </div>

                {isKorean ? (
                    <div className="space-y-10 prose prose-invert max-w-none">
                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">1. 개요</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed">
                                BurilLab(이하 "본 앱")은 연구실 시약 관리를 위한 서비스입니다.
                                본 개인정보처리방침은 본 앱이 사용자의 정보를 어떻게 수집, 사용, 보호하는지에 대해 설명합니다.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">2. 수집하는 개인정보</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed mb-4">본 앱은 서비스 제공을 위해 최소한의 정보만을 수집합니다.</p>
                            
                            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50 mb-6">
                                <table className="w-full text-left text-sm whitespace-nowrap">
                                    <thead className="bg-slate-800/50 text-slate-300">
                                        <tr>
                                            <th className="px-5 py-3 font-medium border-b border-slate-800">수집 항목</th>
                                            <th className="px-5 py-3 font-medium border-b border-slate-800">수집 목적</th>
                                        </tr>
                                    </thead>
                                    <tbody className="text-slate-400">
                                        <tr>
                                            <td className="px-5 py-3 border-b border-slate-800/50">이메일 주소</td>
                                            <td className="px-5 py-3 border-b border-slate-800/50">회원가입 및 로그인 인증</td>
                                        </tr>
                                        <tr>
                                            <td className="px-5 py-3">비밀번호 (암호화 저장)</td>
                                            <td className="px-5 py-3">계정 보안 및 인증</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <div className="bg-blue-900/20 border border-blue-800/50 rounded-xl p-5">
                                <p className="text-blue-200/80 text-sm m-0">💡 본 앱은 사용자의 위치 정보, 연락처, 사진, 결제 정보 등 민감한 개인정보를 수집하지 않습니다.</p>
                            </div>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">3. 개인정보의 이용 목적</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed mb-3">수집된 정보는 다음의 목적으로만 사용됩니다:</p>
                            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                                <li><strong className="text-slate-300">사용자 인증</strong> — 로그인 및 계정 관리</li>
                                <li><strong className="text-slate-300">서비스 제공</strong> — 시약 관리 기능 이용</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">4. 개인정보의 제3자 제공</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed mb-3">
                                본 앱은 사용자의 개인정보를 제3자에게 판매, 교환, 또는 공유하지 않습니다.
                                다만, 인증 서비스 운영을 위해 아래의 서비스 제공자를 이용합니다:
                            </p>
                            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                                <li><strong className="text-slate-300">Supabase</strong> — 사용자 인증 및 데이터 저장 (서버: AWS 클라우드)</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">5. 개인정보의 보관 및 파기</h2>
                            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                                <li>사용자의 개인정보는 계정이 유지되는 동안 보관됩니다.</li>
                                <li>계정 삭제 완료 시, 해당 사용자와 관련된 모든 데이터(이메일, 닉네임, 등록한 시약 데이터, 활동 로그 및 검색 기록)는 즉시 및 영구적으로 삭제됩니다.</li>
                                <li>비밀번호는 단방향 암호화(해시) 처리되어 저장되며, 원본은 보관되지 않습니다.</li>
                            </ul>
                        </section>

                        <section id="delete-account">
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">6. 계정과 관련 데이터의 삭제 방법</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed mb-3">BurilLab은 사용자가 원할 때 언제든지 직접 계정을 삭제하고 모든 데이터를 파기할 수 있는 권리를 보장합니다.</p>
                            
                            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 mb-4">
                                <h3 className="text-sm font-bold text-white mb-2">A. 앱 내에서 직접 삭제하는 방법 (권장)</h3>
                                <ol className="list-decimal pl-5 text-slate-400 space-y-1 text-sm">
                                    <li>BurilLab 앱에 로그인합니다.</li>
                                    <li>메인 화면 우상단의 '설정(톱니바퀴 아이콘)' 메뉴를 클릭합니다.</li>
                                    <li>하단의 <span className="text-red-400 font-medium">'계정 탈퇴'</span> 버튼을 클릭합니다.</li>
                                    <li>화면의 안내에 따라 확인 문구를 입력하면 즉시 계정과 모든 데이터가 삭제됩니다.</li>
                                </ol>
                            </div>

                            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
                                <h3 className="text-sm font-bold text-white mb-2">B. 웹 또는 이메일을 통한 삭제 요청</h3>
                                <p className="text-slate-400 text-sm m-0">
                                    앱 접근이 불가능한 경우, 고객센터 이메일(<a href="mailto:gudwns999999@gmail.com" className="text-blue-400">gudwns999999@gmail.com</a>)로 
                                    계정 이메일 주소와 함께 삭제를 요청하시면 본인 확인 절차 후 7일 이내에 모든 데이터를 파기해 드립니다.
                                </p>
                            </div>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">6. 사용자의 권리</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed mb-3">사용자는 언제든지 다음의 권리를 행사할 수 있습니다:</p>
                            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                                <li>자신의 개인정보 열람 요청</li>
                                <li>개인정보 수정 요청</li>
                                <li>계정 삭제 (개인정보 파기) 요청</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">7. 데이터 보안</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed mb-3">
                                본 앱은 사용자 데이터 보호를 위해 다음과 같은 보안 조치를 적용하고 있습니다:
                            </p>
                            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                                <li>모든 데이터 전송 시 HTTPS(SSL/TLS) 암호화 적용</li>
                                <li>비밀번호 단방향 암호화(해시) 저장</li>
                                <li>Row Level Security(RLS)를 통한 데이터 접근 제어</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">8. 개인정보처리방침 변경</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed">
                                본 개인정보처리방침은 관련 법령 또는 서비스 변경에 따라 수정될 수 있습니다.
                                변경 사항은 본 페이지를 통해 공지됩니다.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">9. 문의</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed mb-4">개인정보 관련 문의사항이 있으시면 아래로 연락해 주세요.</p>
                            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                                <p className="text-slate-300 text-sm mb-2"><strong className="text-white">서비스명:</strong> BurilLab</p>
                                <p className="text-slate-300 text-sm m-0">
                                    <strong className="text-white">이메일:</strong>{' '}
                                    <a href="mailto:gudwns999999@gmail.com" className="text-blue-400 hover:text-blue-300 hover:underline">
                                        gudwns999999@gmail.com
                                    </a>
                                </p>
                            </div>
                        </section>
                    </div>
                ) : (
                    <div className="space-y-10 prose prose-invert max-w-none">
                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">1. Overview</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed">
                                BurilLab ("the App") is a laboratory reagent management service.
                                This Privacy Policy describes how the App collects, uses, and protects user information.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">2. Information We Collect</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed mb-4">The App collects only the minimum information necessary to provide the service.</p>
                            
                            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50 mb-6">
                                <table className="w-full text-left text-sm whitespace-nowrap">
                                    <thead className="bg-slate-800/50 text-slate-300">
                                        <tr>
                                            <th className="px-5 py-3 font-medium border-b border-slate-800">Data Collected</th>
                                            <th className="px-5 py-3 font-medium border-b border-slate-800">Purpose</th>
                                        </tr>
                                    </thead>
                                    <tbody className="text-slate-400">
                                        <tr>
                                            <td className="px-5 py-3 border-b border-slate-800/50">Email address</td>
                                            <td className="px-5 py-3 border-b border-slate-800/50">Account registration and login authentication</td>
                                        </tr>
                                        <tr>
                                            <td className="px-5 py-3">Password (stored encrypted)</td>
                                            <td className="px-5 py-3">Account security and authentication</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <div className="bg-blue-900/20 border border-blue-800/50 rounded-xl p-5">
                                <p className="text-blue-200/80 text-sm m-0">💡 The App does not collect sensitive personal information such as location data, contacts, photos, or payment information.</p>
                            </div>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">3. How We Use Your Information</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed mb-3">Collected information is used solely for the following purposes:</p>
                            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                                <li><strong className="text-slate-300">User Authentication</strong> — Login and account management</li>
                                <li><strong className="text-slate-300">Service Delivery</strong> — Access to reagent management features</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">4. Third-Party Sharing</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed mb-3">
                                The App does not sell, trade, or share user personal information with third parties.
                                However, the following service providers are used for authentication:
                            </p>
                            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                                <li><strong className="text-slate-300">Supabase</strong> — User authentication and data storage (hosted on AWS Cloud)</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">5. Data Retention and Deletion</h2>
                            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                                <li>Personal information is retained for the duration of the account's existence.</li>
                                <li>Upon completion of account deletion, all data associated with the user (email, nickname, registered reagent data, activity logs, and search history) is immediately and permanently deleted.</li>
                                <li>Passwords are stored using one-way encryption (hashing); original passwords are never retained.</li>
                            </ul>
                        </section>

                        <section id="delete-account-en">
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">6. How to Delete Your Account and Data</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed mb-3">BurilLab ensures your right to delete your account and destroy all data at any time.</p>
                            
                            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 mb-4">
                                <h3 className="text-sm font-bold text-white mb-2">A. Deletion via the App (Recommended)</h3>
                                <ol className="list-decimal pl-5 text-slate-400 space-y-1 text-sm">
                                    <li>Log in to the BurilLab app.</li>
                                    <li>Click on the 'Settings (Gear icon)' in the upper right.</li>
                                    <li>Click the <span className="text-red-400 font-medium">'Delete Account'</span> button at the bottom.</li>
                                    <li>Follow the prompts and enter the confirmation phrase to immediately delete your account and all data.</li>
                                </ol>
                            </div>

                            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
                                <h3 className="text-sm font-bold text-white mb-2">B. Request via Email</h3>
                                <p className="text-slate-400 text-sm m-0">
                                    If you cannot access the app, you can request deletion by emailing <a href="mailto:gudwns999999@gmail.com" className="text-blue-400">gudwns999999@gmail.com</a> with 
                                    your registered email address. We will destroy all data within 7 days after identity verification.
                                </p>
                            </div>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">6. Your Rights</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed mb-3">Users may exercise the following rights at any time:</p>
                            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                                <li>Request access to their personal information</li>
                                <li>Request correction of personal information</li>
                                <li>Request account deletion (data erasure)</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">7. Data Security</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed mb-3">The App implements the following security measures to protect user data:</p>
                            <ul className="list-disc pl-5 text-slate-400 space-y-2 text-[15px]">
                                <li>HTTPS (SSL/TLS) encryption for all data transmission</li>
                                <li>One-way password hashing</li>
                                <li>Row Level Security (RLS) for data access control</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">8. Changes to This Policy</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed">
                                This Privacy Policy may be updated in accordance with applicable laws or service changes.
                                Any changes will be posted on this page.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3 pl-3 border-l-4 border-blue-500">9. Contact Us</h2>
                            <p className="text-slate-400 text-[15px] leading-relaxed mb-4">For privacy-related inquiries, please contact us at:</p>
                            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                                <p className="text-slate-300 text-sm mb-2"><strong className="text-white">Service:</strong> BurilLab</p>
                                <p className="text-slate-300 text-sm m-0">
                                    <strong className="text-white">Email:</strong>{' '}
                                    <a href="mailto:gudwns999999@gmail.com" className="text-blue-400 hover:text-blue-300 hover:underline">
                                        gudwns999999@gmail.com
                                    </a>
                                </p>
                            </div>
                        </section>
                    </div>
                )}

                <div className="mt-16 pt-8 border-t border-slate-800 text-center text-slate-500 text-sm">
                    &copy; 2026 BurilLab. All rights reserved.
                </div>
            </div>
        </div>
    );
};
