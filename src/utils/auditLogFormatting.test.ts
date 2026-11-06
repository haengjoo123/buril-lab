import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { translations } from '../locales/translations';
import {
    buildAuditEventDescription,
    formatAuditActionName,
    formatAuditEntityName,
    getAuditActionCategory,
    getAuditChangeRows,
    getAuditDetailSections,
} from './auditLogFormatting';
import { hazardFlagLabel, wasteStreamLabel } from './wasteLabels';

const i18n = createInstance();
await i18n.init({ lng: 'ko', resources: { ko: { translation: translations.ko } } });

describe('user-facing activity history', () => {
    it('keeps readable changes and hides internal fields, snapshots, and identifiers', () => {
        const diff = {
            quantity: { from: 2, to: 1 },
            remaining_percent: { from: 80, to: 50 },
            storage_type: { from: 'cabinet', to: 'other' },
            memo: { from: '기존 메모', to: '새 메모' },
            updated_at: { from: '2026-10-17', to: '2026-10-18' },
            request_id: { from: null, to: 'internal-request' },
            analysis_snapshot: { from: {}, to: { internal: 'secret' } },
            future_internal_field: { from: 'raw_code', to: 'raw_code_2' },
            cabinet_id: { from: null, to: 'edb1c829-6064-4fd9-a7dc-e03a05a6653b' },
        };
        const rows = getAuditChangeRows({ diff_data: diff }, i18n.t, 'ko');
        expect(rows.map((row) => row.key)).toEqual(['quantity', 'remaining_percent', 'storage_type', 'memo']);
        expect(rows[0]).toMatchObject({ label: '수량', fromText: '2', toText: '1' });
        expect(rows[1]).toMatchObject({ fromText: '80%', toText: '50%' });
        expect(rows[2].fromText).not.toBe('cabinet');
        expect(rows[3].toText).toBe('새 메모');
        const sections = getAuditDetailSections({ before_data: null, after_data: Object.fromEntries(
            Object.entries(diff).map(([key, value]) => [key, value.to]),
        ) }, i18n.t, 'ko');
        expect(sections[0].rows.map((row) => row.key)).toEqual(rows.map((row) => row.key));
    });

    it('translates container states and never treats an unknown state as collected', () => {
        const rows = getAuditChangeRows({ diff_data: {
            status: { from: 'active', to: 'future_status' },
            stream_code: { from: 'ACID_AQUEOUS', to: 'SPECIAL_REVIEW' },
        } }, i18n.t, 'ko');
        expect(rows.find((row) => row.key === 'status')?.toText).toBe('알 수 없음');
        expect(rows.find((row) => row.key === 'stream_code')?.toText).toBe('분리 보관·특별 검토');
    });

    it('keeps a review notice for unknown hazard and waste classification codes', () => {
        expect(hazardFlagLabel('NEW_HAZARD', 'ko')).toBe('추가 위험 정보 확인 필요');
        expect(wasteStreamLabel('NEW_STREAM', 'ko')).toBe('분류 확인 필요');
        expect(hazardFlagLabel('CORROSIVE', 'en')).toBe('Corrosive');
    });
});

describe('lab admin action records', () => {
    const MEMBER_ID = 'f3000000-0000-4000-8000-000000000002';
    const memberNames = { [MEMBER_ID]: '김연구' };

    it('shows a role change with role labels and never the account identifier', () => {
        const log = {
            actor_name: 'Admin A',
            action: 'role_change',
            entity_type: 'lab_member',
            location_context: null,
            before_data: { user_id: MEMBER_ID, role: 'student' },
            after_data: { user_id: MEMBER_ID, role: 'graduate' },
            diff_data: { role: { from: 'student', to: 'graduate' } },
        };
        const rows = getAuditChangeRows(log, i18n.t, 'ko');
        expect(rows).toEqual([{ key: 'role', label: '역할', fromText: '연구원', toText: '대학원생' }]);
        const sections = getAuditDetailSections(log, i18n.t, 'ko');
        expect(sections.flatMap((section) => section.rows.map((row) => row.key))).toEqual(['role', 'role']);
        expect(JSON.stringify(sections)).not.toContain(MEMBER_ID);
        expect(buildAuditEventDescription(log, i18n.t, 'ko', { memberNames }))
            .toBe('Admin A님이 김연구님의 역할을 연구원에서 대학원생(으)로 바꿨습니다.');
        expect(formatAuditEntityName('lab_member', i18n.t)).toBe('멤버');
        expect(formatAuditActionName('role_change', i18n.t, log)).toBe('역할 변경');
        expect(getAuditActionCategory(log)).toBe('update');
    });

    it('describes joins, departures, and removals, with a former member when the name is unknown', () => {
        const base = { actor_name: 'Admin A', entity_type: 'lab_member', location_context: null, diff_data: null };
        const join = { ...base, actor_name: 'New member', action: 'join', before_data: null, after_data: { user_id: MEMBER_ID, role: 'student' } };
        const leave = { ...base, actor_name: 'Leaver', action: 'leave', before_data: { user_id: MEMBER_ID, role: 'student' }, after_data: null };
        const remove = { ...base, action: 'remove', before_data: { user_id: MEMBER_ID, role: 'graduate' }, after_data: null };
        // After the account deletion scrub the row keeps no user_id and no actor.
        const scrubbed = { ...base, actor_name: null, action: 'remove', before_data: { role: 'student' }, after_data: null };

        expect(buildAuditEventDescription(join, i18n.t, 'ko')).toBe('New member님이 연구실에 가입했습니다.');
        expect(buildAuditEventDescription(leave, i18n.t, 'ko')).toBe('Leaver님이 연구실에서 나갔습니다.');
        expect(buildAuditEventDescription(remove, i18n.t, 'ko', { memberNames }))
            .toBe('Admin A님이 김연구님을 연구실에서 제외했습니다.');
        expect(buildAuditEventDescription(remove, i18n.t, 'ko', { memberNames: {} }))
            .toBe('Admin A님이 이전 멤버님을 연구실에서 제외했습니다.');
        expect(buildAuditEventDescription(scrubbed, i18n.t, 'ko', { memberNames }))
            .toBe('알 수 없는 사용자님이 이전 멤버님을 연구실에서 제외했습니다.');
        expect(formatAuditActionName('join', i18n.t, join)).toBe('가입');
        expect(formatAuditActionName('remove', i18n.t, remove)).toBe('제외');
        expect(formatAuditActionName('leave', i18n.t, leave)).toBe('나가기');
        expect(getAuditActionCategory(join)).toBe('create');
        expect(getAuditActionCategory(leave)).toBe('delete');
        expect(getAuditActionCategory(remove)).toBe('delete');
    });

    it('labels center link status, scope, and center in records and descriptions', () => {
        const request = {
            actor_name: 'Audit center',
            action: 'link_request',
            entity_type: 'safety_center_link',
            location_context: null,
            before_data: { status: 'approved', scope: ['summary'] },
            after_data: { status: 'requested', scope: ['summary', 'exports', 'future_scope'], center_name: 'Audit center' },
            diff_data: {
                status: { from: 'approved', to: 'requested' },
                scope: { from: ['summary'], to: ['summary', 'exports', 'future_scope'] },
            },
        };
        const rows = getAuditChangeRows(request, i18n.t, 'ko');
        expect(rows.map((row) => row.key)).toEqual(['status', 'scope']);
        expect(rows[0]).toMatchObject({ label: '상태', fromText: '승인됨', toText: '요청중' });
        expect(rows[1]).toMatchObject({ label: '공개 범위', fromText: '요약', toText: '요약, 내보내기, future_scope' });
        const after = getAuditDetailSections(request, i18n.t, 'ko').find((section) => section.key === 'after');
        expect(after?.rows.map((row) => [row.label, row.value])).toEqual([
            ['상태', '요청중'],
            ['공개 범위', '요약, 내보내기, future_scope'],
            ['센터', 'Audit center'],
        ]);
        expect(buildAuditEventDescription(request, i18n.t, 'ko'))
            .toBe('Audit center이(가) 연결을 요청했습니다. 공개 범위: 요약, 내보내기, future_scope');
        expect(formatAuditActionName('link_request', i18n.t, request)).toBe('연결 요청');

        const approve = { ...request, actor_name: 'Admin A', action: 'link_approve', after_data: { ...request.after_data, status: 'approved' } };
        expect(buildAuditEventDescription(approve, i18n.t, 'ko')).toBe('Admin A님이 Audit center 연결을 승인했습니다.');
        expect(buildAuditEventDescription({ ...approve, action: 'link_reject' }, i18n.t, 'ko')).toBe('Admin A님이 Audit center 연결을 거절했습니다.');
        expect(buildAuditEventDescription({ ...approve, action: 'link_revoke' }, i18n.t, 'ko')).toBe('Admin A님이 Audit center 연결을 철회했습니다.');
        expect(buildAuditEventDescription({ ...approve, action: 'scope_change', after_data: { scope: ['summary'] } }, i18n.t, 'ko'))
            .toBe('센터 공개 범위가 요약(으)로 바뀌었습니다.');
        expect(getAuditActionCategory(approve)).toBe('update');
        expect(getAuditActionCategory({ ...approve, action: 'scope_change' })).toBe('update');
        expect(getAuditChangeRows({ diff_data: { status: { from: 'approved', to: 'future_status' } } }, i18n.t, 'ko')[0].toText)
            .toBe('알 수 없음');
    });

    it('lists which site settings changed without ever showing their values', () => {
        const create = {
            actor_name: 'Admin A',
            action: 'create',
            entity_type: 'waste_policy_override',
            location_context: null,
            before_data: null,
            after_data: {
                stream_code: 'ORGANIC_NON_HALOGENATED',
                is_disabled: false,
                changed_fields: ['container_label', 'handler_contact', 'location', 'future_field'],
            },
            diff_data: null,
        };
        const after = getAuditDetailSections(create, i18n.t, 'ko')[0];
        expect(after.rows.map((row) => [row.key, row.value])).toEqual([
            ['stream_code', '비할로겐 유기 폐액'],
            ['is_disabled', '아니오'],
            ['changed_fields', '폐액통 이름, 담당 연락처, 위치, 알 수 없음'],
        ]);
        expect(after.rows.find((row) => row.key === 'changed_fields')?.label).toBe('바뀐 항목');
        expect(buildAuditEventDescription(create, i18n.t, 'ko')).toBe('Admin A님이 비할로겐 유기 폐액 현장 설정을 저장했습니다.');

        const update = { ...create, action: 'update', diff_data: { is_disabled: { from: false, to: true } } };
        expect(getAuditChangeRows(update, i18n.t, 'ko')).toEqual([{ key: 'is_disabled', label: '사용 중지', fromText: '아니오', toText: '예' }]);
        expect(buildAuditEventDescription(update, i18n.t, 'ko')).toBe('Admin A님이 비할로겐 유기 폐액 현장 설정을 바꿨습니다.');

        const reset = { ...create, action: 'delete', before_data: { stream_code: 'ORGANIC_NON_HALOGENATED', is_disabled: false }, after_data: null };
        expect(buildAuditEventDescription(reset, i18n.t, 'ko'))
            .toBe('Admin A님이 비할로겐 유기 폐액 현장 설정을 기관 정책으로 되돌렸습니다.');
        expect(formatAuditEntityName('waste_policy_override', i18n.t)).toBe('폐액통 현장 설정');
    });

    it('keeps the generic description for existing record types', () => {
        expect(buildAuditEventDescription({
            actor_name: 'Admin A', action: 'create', entity_type: 'inventory', location_context: null,
            before_data: null, after_data: { name: 'Acetone' },
        }, i18n.t, 'ko')).toBe('Admin A님이 Acetone을(를) 등록했습니다.');
    });
});
