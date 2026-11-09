import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import '../../src/index.css';
import '../../src/locales/i18n';
import { AdaptiveViewportProvider } from '../../src/components/AdaptiveViewportProvider';
import { MainLayout } from '../../src/components/MainLayout';
import { InventoryListView } from '../../src/features/inventory/InventoryListView';
import { SearchTabView } from '../../src/components/SearchTabView';
import { CartView } from '../../src/components/CartView';
import { WasteLogView } from '../../src/components/WasteLogView';
import { FridgeView } from '../../src/features/fridge/FridgeView';
import { LabAdminView } from '../../src/features/admin/LabAdminView';
import { OpsConsoleView } from '../../src/features/ops/OpsConsoleView';
import { inventoryService, storageLocationService, type InventoryItem } from '../../src/services/inventoryService';
import { cabinetService } from '../../src/services/cabinetService';
import { labService } from '../../src/services/labService';
import { safetyCenterService } from '../../src/services/safetyCenterService';
import { labAdminSourceLoaders } from '../../src/services/labAdminOverviewService';
import type { SafetyCenterApprovalItem } from '../../src/services/opsAdminService';
import type { AnalyticsGovernance, AnalyticsKpis, AnalyticsSummary } from '../../src/services/opsAnalyticsService';
import type { LabSafetyCenterLinkRequest, LabSafetyCenterRequest } from '../../src/features/safety-center/types';
import type { FeedbackInboxItem } from '../../src/types/feedback';
import { useOnboardingStore } from '../../src/store/useOnboardingStore';
import { useLabStore, type LabMember } from '../../src/store/useLabStore';
import { useWasteStore } from '../../src/store/useWasteStore';
import { useFridgeStore } from '../../src/store/fridgeStore';
import type { AppTab } from '../../src/hooks/useAppUiState';
import { useLabAdminAttentionCount } from '../../src/hooks/useLabAdminAttentionCount';
import type { AnalysisResult } from '../../src/types';
import { serviceStubs } from './serviceStubs';

const noop = () => {};
const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'inventory';
const cartCount = params.get('emptyCart') === '1' ? 0 : 1;
// ?quiet=1 (admin, ops): every source loads, but nothing needs handling.
const quiet = params.get('quiet') === '1';
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
const pad = (value: number) => String(value).padStart(2, '0');
/** Local calendar date, the way the inventory reads expiry dates. */
const localDate = (offsetDays: number) => {
  const date = new Date(Date.now() + offsetDays * DAY_MS);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
/** Asia/Seoul calendar date, the way centers set due dates. */
const seoulDate = (offsetDays: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(Date.now() + offsetDays * DAY_MS);

const item: InventoryItem = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Adaptive reagent', quantity: 2,
  lab_id: null, user_id: null, brand: 'Fixture', product_number: null, cas_number: '67-64-1',
  capacity: '100 mL', storage_type: 'other', cabinet_id: null, storage_location_id: null, product_id: null,
  expiry_date: null, manufacturer_date_type: 'expiry', received_date: null, opened_date: null, memo: null,
  remaining_percent: 100, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};

// --- Lab admin (?screen=admin): the user is the admin of one lab ---------------------------------
const labId = '66666666-6666-4666-8666-666666666666';
const centerName = '버릴대학교 연구안전센터';
const membership: LabMember = {
  id: '66666666-6666-4666-8666-000000000001', lab_id: labId, user_id: 'fixture-user', role: 'admin', joined_at: '2025-03-02T00:00:00Z',
  lab: { id: labId, name: '화학공학 3연구실', created_by: 'fixture-user', created_at: '2025-03-02T00:00:00Z', institution_name: '버릴대학교', join_password_needs_change: false },
};
const labItems: InventoryItem[] = [
  { ...item, id: '11111111-1111-4111-8111-000000000002', lab_id: labId, name: '헥산', cas_number: '110-54-3' },
  ...(quiet ? [] : [
    { ...item, id: '11111111-1111-4111-8111-000000000003', lab_id: labId, name: '아세톤', expiry_date: localDate(-1) },
    { ...item, id: '11111111-1111-4111-8111-000000000004', lab_id: labId, name: '에탄올', cas_number: '64-17-5', expiry_date: localDate(5) },
  ]),
];
const labMembers = [
  { user_id: 'fixture-user', role: 'admin', joined_at: '2025-03-02T00:00:00Z', email: 'fixture@example.invalid' },
  { user_id: '33333333-3333-4333-8333-000000000001', role: 'graduate', joined_at: '2025-09-01T00:00:00Z', email: 'graduate@example.invalid' },
  ...(quiet ? [] : [{ user_id: '33333333-3333-4333-8333-000000000002', role: 'student', joined_at: daysAgo(3), email: 'new.member@example.invalid' }]),
];
const centerRequest: LabSafetyCenterRequest = {
  id: '44444444-4444-4444-8444-000000000001', center_id: '77777777-7777-4777-8777-000000000001', center_name: centerName, lab_id: labId,
  target_type: null, target_id: null, title: 'MSDS 비치 확인', description: '시약장 옆에 MSDS가 비치되어 있는지 사진으로 알려 주세요.',
  priority: 'high', status: 'open', due_date: seoulDate(-2), created_at: daysAgo(9), updated_at: daysAgo(9),
};
const linkRequest: LabSafetyCenterLinkRequest = {
  link_id: '55555555-5555-4555-8555-000000000001', center_id: '77777777-7777-4777-8777-000000000001', center_name: centerName,
  institution_name: '버릴대학교', institution_domain: 'buril.example', center_status: 'approved', link_status: 'requested',
  link_scope: ['summary', 'risk_detail'], requested_at: daysAgo(1), responded_at: null,
};

inventoryService.getItems = async () => {
  document.documentElement.dataset.inventoryLoads = String(Number(document.documentElement.dataset.inventoryLoads ?? 0) + 1);
  if (screen === 'admin') return labItems;
  if (params.get('inventoryRows') === 'many') return Array.from({ length: 24 }, (_, index) => ({
    ...item,
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    name: index === 0 ? item.name : `재고 확인용 시약 ${String(index + 1).padStart(2, '0')}`,
    cas_number: index === 0 ? item.cas_number : null,
    product_number: `INV-FIXTURE-${String(index + 1).padStart(2, '0')}`,
  }));
  return [item];
};
storageLocationService.getLocations = async () => [];
cabinetService.getCabinets = async () => [];
if (screen === 'admin') {
  useLabStore.setState({ currentLabId: labId, lastLabId: labId, myLabs: [membership], labsLoaded: true });
  labService.getMyLabs = async () => [membership];
  labService.getLabMembers = async () => labMembers;
  safetyCenterService.getLabRequests = async () => (quiet ? [] : [centerRequest]);
  safetyCenterService.getLabLinkRequests = async () => (quiet ? [] : [linkRequest]);
  // The overview's own DANGER query (safety_compliance_events), answered without Supabase.
  labAdminSourceLoaders.dangerWarnings = async () => (quiet ? { count: 0, latest: [] } : {
    count: 1,
    latest: [{
      id: '99999999-9999-4999-8999-000000000001', createdAt: daysAgo(2), primaryName: '질산', secondaryName: '에탄올',
      cabinetId: 'fixture-cabinet', cabinetName: '시약장 B-2', shelfId: 'fixture-floor', itemId: 'fixture-bottle',
    }],
  });
}

// --- Operator console (?screen=ops), rendered at /ops -----------------------------------------
const approval = (row: Pick<SafetyCenterApprovalItem, 'id' | 'center_name' | 'institution_name' | 'institution_domain' | 'status' | 'created_at'>
  & Partial<SafetyCenterApprovalItem>): SafetyCenterApprovalItem => ({
  created_by: '88888888-8888-4888-8888-000000000001', approved_by: null, approved_at: null,
  verification_document_path: null, verification_document_name: null, verification_document_mime_type: null,
  verification_document_size: null, verification_document_uploaded_at: null, updated_at: row.created_at,
  requester_email_domain: null, domain_matches: null, ...row,
});
const withDocument = (createdAt: string): Partial<SafetyCenterApprovalItem> => ({
  verification_document_path: 'fixture/verification.pdf', verification_document_name: '재직증명서.pdf',
  verification_document_mime_type: 'application/pdf', verification_document_size: 182_340, verification_document_uploaded_at: createdAt,
});
// Newest first, like the list API.
const approvals: SafetyCenterApprovalItem[] = [
  approval({ id: '77777777-7777-4777-8777-000000000002', center_name: '한빛공과대학교 실험실안전팀', institution_name: '한빛공과대학교',
    institution_domain: 'hanbit.example', status: 'pending', created_at: daysAgo(1), requester_email_domain: 'mail.example', domain_matches: false,
    ...withDocument(daysAgo(1)) }),
  approval({ id: '77777777-7777-4777-8777-000000000003', center_name: '버릴대학교 연구안전센터', institution_name: '버릴대학교',
    institution_domain: 'buril.example', status: 'pending', created_at: daysAgo(4), requester_email_domain: 'buril.example', domain_matches: true,
    ...withDocument(daysAgo(4)) }),
  approval({ id: '77777777-7777-4777-8777-000000000001', center_name: '새솔대학교 환경안전원', institution_name: '새솔대학교',
    institution_domain: 'saesol.example', status: 'approved', created_at: daysAgo(40), approved_at: daysAgo(38),
    approved_by: '88888888-8888-4888-8888-000000000002', updated_at: daysAgo(38) }),
  // Rejected with a reason and a long note (the row truncates it at 320px; ?status=rejected).
  approval({ id: '77777777-7777-4777-8777-000000000004', center_name: '가온대학교 안전관리팀', institution_name: '가온대학교',
    institution_domain: 'gaon.example', status: 'rejected', created_at: daysAgo(60), updated_at: daysAgo(58),
    review_reason: 'other', review_note: '제출한 재직 증명서의 발급일이 1년이 지났습니다. 최근 3개월 안에 발급된 증명서나 부서 공문을 문의하기 메일로 보내 주세요.',
    ...withDocument(daysAgo(60)) }),
];
const feedbackItem = (row: Pick<FeedbackInboxItem, 'id' | 'type' | 'message' | 'status' | 'created_at'> & Partial<FeedbackInboxItem>): FeedbackInboxItem => ({
  contact: null, user_email: 'researcher@example.invalid', user_id: '33333333-3333-4333-8333-000000000003',
  user_agent: 'Mozilla/5.0 (Linux; Android 14) Fixture', resolved_at: null, resolved_by: null, lab_id: null, source_screen: null, ...row,
});
const feedback: FeedbackInboxItem[] = [
  feedbackItem({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', type: 'improvement', status: 'new', created_at: daysAgo(0.1),
    lab_id: '66666666-6666-4666-8666-666666666666', source_screen: 'logs', lab_name: '화학공학 3연구실 (유기합성·고분자 공정 연구 그룹)',
    message: '폐액통 목록에서 할로겐 계열만 모아 보면 좋겠습니다.' }),
  feedbackItem({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', type: 'bug', status: 'new', created_at: daysAgo(1), source_screen: 'cabinet',
    message: '시약장 편집에서 선반 추가 버튼이 가끔 눌리지 않습니다.' }),
  feedbackItem({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003', type: 'bug', status: 'new', created_at: daysAgo(3), contact: 'researcher@example.invalid',
    message: '바코드 스캔 후 검색 결과가 비어 있습니다.' }),
  feedbackItem({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004', type: 'general', status: 'resolved', created_at: daysAgo(10),
    resolved_at: daysAgo(8), resolved_by: '88888888-8888-4888-8888-000000000002', message: '연구실 초대 방법을 알고 싶습니다.' }),
];
const analyticsSummary = (days: number): AnalyticsSummary => {
  const dailyTrend = Array.from({ length: days }, (_, index) => {
    const searches = 38 + ((index * 17) % 29);
    return { date: seoulDate(index - days + 1), searches, noResults: Math.round(searches * 0.08) };
  });
  const submittedSearches = dailyTrend.reduce((sum, day) => sum + day.searches, 0);
  return {
    periodDays: days, submittedSearches, uniqueUsers: Math.round(submittedSearches / 9), noResultRate: 8.1, technicalErrorRate: 0.4,
    ingestionRecoveryCount: 1, analyticsIngestionFailureRate: 0.3, batchConversionRate: 21.5,
    finalizedBatches: Math.round(days * 3.4), mixedBatches: Math.round(days * 0.9),
    dataCompleteness: { itemCount: days * 11, casPercent: 92.4, concentrationPercent: 71.8, volumePercent: 88 }, dailyTrend,
  };
};
const governance: AnalyticsGovernance = {
  collection: { authenticatedEvents: 2841, guestEvents: 612, guestSubjects: 187, guestEventsExpiringIn7Days: 44, oldestGuestEventAt: daysAgo(83) },
  deletions: { requestCount: 2, deletedEvents: 57, deletedActions: 9 },
  exports: { count: 1, lastExportAt: daysAgo(12), allAudited: true },
  monthlyRollups: { searchCells: 318, mixtureCells: 41, externalSearchCells: 0, externalMixtureCells: 0 },
  commercialization: {
    externalProductEnabled: false, institutionDataAgreementReady: false, reidentificationRiskReviewReady: false, legalReviewReady: false,
    searchThreshold: { events: 20, users: 5, labs: 3 }, mixtureThreshold: { batches: 10, users: 5, labs: 3 }, monthlyOnly: true, retroactiveInclusion: false,
  },
  reviews: { pending: quiet ? 0 : 7, approved: 12, rejected: 3 },
};
/**
 * analytics_admin_kpis_v1 for the home (asked with includeKpis). The inbox matches the stubbed lists and
 * governance (2 pending centers, 3 new suggestions, 7 candidates; all 0 when quiet). The long
 * institution and brand names check truncation and wrapping at 320px.
 */
const fixtureKpis = (days: number): AnalyticsKpis => {
  // Period metrics grow with the window; fixed-window metrics (WSAL, cohorts, seats) do not.
  const scale = days >= 30 ? 4 : 1;
  const funnel = (shown: number, stepCompleted: number, allStepsCompleted: number, firstValueReached: number, skipped: number) =>
    ({ shown: shown * scale, stepCompleted: stepCompleted * scale, allStepsCompleted: allStepsCompleted * scale,
      firstValueReached: firstValueReached * scale, skipped: skipped * scale });
  const weeklyLabs = [12, 14, 15, 17, 18, 20, 20, 23];
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    period: { days, timeZone: 'Asia/Seoul', currentStart: daysAgo(days), currentEnd: new Date().toISOString(), previousStart: daysAgo(days * 2) },
    exclusions: { internalLabs: 2, internalUsers: 3 },
    inbox: {
      centers: quiet ? { count: 0, oldestCreatedAt: null } : { count: 2, oldestCreatedAt: daysAgo(4) },
      feedback: quiet
        ? { count: 0, byType: { bug: 0, improvement: 0, general: 0 }, oldestCreatedAt: null }
        : { count: 3, byType: { bug: 2, improvement: 1, general: 0 }, oldestCreatedAt: daysAgo(3) },
      reviews: quiet ? { count: 0, oldestCreatedAt: null, lastUpdatedAt: null } : { count: 7, oldestCreatedAt: daysAgo(9), lastUpdatedAt: daysAgo(1) },
    },
    product: {
      wsal: {
        current: weeklyLabs[7], previous: weeklyLabs[6], totalLabs: 41,
        weekly: weeklyLabs.map((labs, index) => ({ start: daysAgo(7 * (8 - index)), end: daysAgo(7 * (7 - index)), labs })),
      },
      activeUsers: {
        wau: { current: 38, previous: 34 }, mau: { current: 71, previous: 66 },
        stickiness: { current: { numerator: 38, denominator: 71 }, previous: { numerator: 34, denominator: 69 } },
      },
      activation14d: {
        current: { cohortLabs: 13, secondMember: 9, firstItem: 8, firstWasteRecord: 6, fullyActivated: 5 },
        previous: { cohortLabs: 11, secondMember: 7, firstItem: 7, firstWasteRecord: 4, fullyActivated: 3 },
      },
      retentionW4: { current: { numerator: 11, denominator: 18 }, previous: { numerator: 9, denominator: 16 } },
      onboarding: {
        web: { current: funnel(21, 17, 9, 14, 3), previous: funnel(18, 15, 8, 11, 4) },
        native: { current: funnel(6, 4, 2, 3, 2), previous: funnel(5, 3, 1, 2, 1) },
      },
    },
    safety: {
      needsReview: {
        current: { numerator: 9 * scale, denominator: 74 * scale, needsInput: 6 * scale, blocked: 3 * scale },
        previous: { numerator: 7 * scale, denominator: 61 * scale, needsInput: 5 * scale, blocked: 2 * scale },
        topMissingFields: [{ field: 'measured_ph', records: 4 * scale }, { field: 'mixing_state', records: 3 * scale }, { field: 'hazard_data', records: 2 * scale }],
      },
      corrections: {
        current: { numerator: 3 * scale, denominator: 77 * scale }, previous: { numerator: 2 * scale, denominator: 63 * scale },
        byReason: { amount: scale, duplicate: scale, category: 0, other: scale },
      },
      dangerIgnored: quiet
        ? { current: { events: 0, labs: 0 }, previous: { events: 1, labs: 1 }, topRules: [] }
        : { current: { events: 3 * scale, labs: 2 }, previous: { events: scale, labs: 1 },
          topRules: [{ ruleId: 'store_flam_oxid', events: 2 * scale }, { ruleId: 'store_acid_cyanide', events: scale }] },
      centerRequests: quiet
        ? { open: 0, overdue: 0, overdueLabs: 0, dueSoon: 0,
          firstResponse: { current: { requests: 0, responded: 0, medianHours: null }, previous: { requests: 3, responded: 3, medianHours: 11 } } }
        : { open: 4, overdue: 1, overdueLabs: 1, dueSoon: 2,
          firstResponse: { current: { requests: 5, responded: 4, medianHours: 7.5 }, previous: { requests: 3, responded: 3, medianHours: 11 } } },
      ghsCheckGaps: {
        current: { numerator: 6 * scale, denominator: 142 * scale, lookupFailed: 4 * scale, notChecked: 2 * scale },
        previous: { numerator: 5 * scale, denominator: 120 * scale, lookupFailed: 3 * scale, notChecked: 2 * scale },
      },
    },
    b2b: {
      // One approved center (approved 2 days after applying); the pending ones applied 1 and 4 days ago.
      centerPipeline: {
        applications: { current: quiet ? 0 : 2, previous: 0 }, pending: quiet ? 0 : 2, approved: 1, rejected: 0,
        approvalDays: { centers: 1, median: 2 }, activeCenters: { current: 1, previous: 1 },
        linkedLabs: 5, linkRequestsPending: quiet ? 0 : 1, requests: { current: 6 * scale, previous: 4 * scale }, exports: { current: 2, previous: 1 },
      },
      institutions: {
        labsTotal: 41, labsWithInstitution: 36, institutions: 14, institutionsWithApprovedCenter: 1, coveredLabs: 4,
        salesCandidates: {
          count: 3,
          top: [
            { institution: '한빛공과대학교 화학생명공학부 및 신소재공학과 연합 공동실험실습관 운영위원회', activeLabs: 4, hasPendingCenter: true },
            { institution: 'pohang university of science and technology graduate school of chemical engineering', activeLabs: 3, hasPendingCenter: false },
            { institution: '버릴대학교', activeLabs: 2, hasPendingCenter: true },
          ],
        },
      },
      labProReadiness: {
        current: { habitualLabs: 7, readyLabs: 4, seats: { upTo2: 3, from3To5: 3, from6To10: 1, over10: 0 } },
        previous: { habitualLabs: 6, readyLabs: 3, seats: { upTo2: 3, from3To5: 2, from6To10: 1, over10: 0 } },
      },
      purchaseIntent: {
        current: { events: 128 * scale, labs: 17, users: 29, withCas: 97 * scale },
        previous: { events: 113 * scale, labs: 15, users: 26, withCas: 80 * scale },
        topBrands: [
          { brand: 'sigma-aldrich', events: 46 * scale, labs: 9, users: 14 },
          { brand: 'thermofisherscientificchemicalsandlaboratoryequipmentdivisionkoreabranchoffice', events: 12 * scale, labs: 3, users: 5 },
        ],
        hiddenBrands: 9,
      },
    },
  };
};
if (screen === 'ops') {
  serviceStubs.listSafetyCenterApprovals = async () => (quiet ? approvals.filter(row => row.status !== 'pending') : approvals);
  serviceStubs.listFeedbackInbox = async () => (quiet ? feedback.filter(row => row.status !== 'new') : feedback);
  serviceStubs.loadAnalyticsSummary = async (days, options) => ({
    summary: analyticsSummary(days), governance, ...(options?.includeKpis ? { kpis: fixtureKpis(days) } : {}),
  });
}

useOnboardingStore.setState({ hasCompletedWelcome: false });
const result: AnalysisResult = {
  chemical: { id: 'fixture-acetone', name: 'Acetone', casNumber: '67-64-1', molecularFormula: 'C3H6O', ghs: { signal: '', hazardStatements: [] } },
  category: 'ORGANIC_NON_HALOGEN', binColor: 'bg-blue-500', label: 'category_organic_non_halogen', reason: 'Fixture', isSafe: true,
};
if (cartCount > 0) useWasteStore.getState().addToCart(result);
useFridgeStore.setState({
  selectedReagentId: params.get('focusShelf') === '1' ? null : 'fixture-bottle',
  focusedShelfId: params.get('focusShelf') === '1' ? 'fixture-floor' : null,
  shelves: [{
  id: 'fixture-floor', level: 0, dividers: [], items: [{
    id: 'fixture-bottle', reagentId: 'fixture-reagent', name: 'Cabinet reagent', shelfId: 'fixture-floor',
    position: 50, width: 8, template: 'A', isAcidic: false, isBasic: false, hCodes: [],
  }],
}] });

export function Fixture() {
  const isAdmin = screen === 'admin';
  const [tab, setTab] = useState<AppTab>(screen === 'cart' ? 'search' : screen as AppTab);
  const [cartOpen, setCartOpen] = useState(screen === 'cart');
  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [searchResult, setSearchResult] = useState<AnalysisResult | null>(null);
  const [hasSearchError, setHasSearchError] = useState(params.get('searchError') === '1');
  const [recentSearches, setRecentSearches] = useState(params.get('recents') === '1'
    ? ['Acetone', '7664-93-9', '64-17-5', '557-21-1', '1185-53-1', '593-84-0'] : []);
  const selectSearchTerm = (term: string) => { setQuery(term); setLastQuery(term); setSearchResult(result); };
  // Same wiring as App: the admin tab badge counts the overdue center request (1, or 0 with ?quiet=1).
  const adminAttentionCount = useLabAdminAttentionCount({ labId: isAdmin ? labId : null, isAdmin, activeTab: tab });
  useEffect(() => { document.documentElement.dataset.fixtureMounts = String(Number(document.documentElement.dataset.fixtureMounts ?? 0) + 1); }, []);
  return <>
    <MainLayout activeTab={tab} isAdmin={isAdmin} onTabClick={setTab} onCartClick={() => setCartOpen(true)} cartCount={cartCount} userEmail="fixture@example.invalid" onSignOut={noop}
      adminAttentionCount={adminAttentionCount}
      recentSearches={recentSearches} onRecentSearchClick={term => { setTab('search'); selectSearchTerm(term); }}
      onRemoveRecentSearch={term => setRecentSearches(terms => terms.filter(value => value !== term))}>
      {tab === 'inventory' ? <InventoryListView userId="fixture-user" />
        : tab === 'cabinet' ? <FridgeView cabinetId="" />
        : tab === 'logs' ? <WasteLogView />
        : tab === 'admin' ? <LabAdminView onStartWasteBatch={async () => {}} />
        : <SearchTabView cartCount={cartCount} query={query} lastSearchQuery={lastQuery} result={searchResult}
          isLoading={params.get('loading') === '1'} isAiAnalyzing={false}
          error={hasSearchError ? '외부 화학 자료 서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.' : null}
          errorKind={hasSearchError ? 'technical' : null} onRetrySearch={() => setHasSearchError(false)}
          wasteComponentSearchMode={params.get('component') === '1'} onReturnToWasteBatch={() => setCartOpen(true)}
          mediaProducts={[]} mediaBrands={[]} mediaCount={0}
          cabinetResults={[]} showAllProducts={false} selectedBrand="" sortBy="name_asc" recentSearches={recentSearches}
          onQueryChange={setQuery} onSearchSubmit={event => { event?.preventDefault(); setLastQuery(query); setSearchResult(result); }}
          onReset={() => { setQuery(''); setLastQuery(''); setSearchResult(null); }} onSuggestionClick={selectSearchTerm} onOpenScanner={noop} onOpenVoiceAgent={params.get('voice') === '1' ? noop : undefined} onClearSearchHistory={() => setRecentSearches([])}
          onRemoveSearchHistory={term => setRecentSearches(terms => terms.filter(value => value !== term))} onCabinetResultClick={async () => {}} onBrandChange={noop} onSortChange={noop}
          onClearFilters={noop} onToggleShowAllProducts={noop} onNavigateToCabinet={noop} onOpenCart={() => setCartOpen(true)} />}
    </MainLayout>
    {cartOpen && <CartView onClose={() => setCartOpen(false)} onDisposed={noop} />}
  </>;
}

// The operator console is its own shell; a memory router puts it at /ops without a server route.
createRoot(document.getElementById('root')!).render(screen === 'ops'
  ? <MemoryRouter initialEntries={['/ops']}><AdaptiveViewportProvider>
    <OpsConsoleView userEmail="operator@example.invalid" onSignOut={noop} onExitToApp={noop} />
  </AdaptiveViewportProvider></MemoryRouter>
  : <BrowserRouter><AdaptiveViewportProvider><Fixture /></AdaptiveViewportProvider></BrowserRouter>);
