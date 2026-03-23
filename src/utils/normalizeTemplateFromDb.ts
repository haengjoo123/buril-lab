import type { ReagentTemplateType } from '../types/fridge';

/**
 * DB에 남은 구형 문자 E(옛 유리병) → D. A–D는 그대로 (마이그레이션 SQL 실행 전제).
 * @see supabase/migrations/20260323120000_cabinet_items_template_abcd.sql
 */
export function normalizeTemplateFromDb(raw: unknown): ReagentTemplateType {
    const t = String(raw ?? 'A').trim().toUpperCase();
    if (t === 'E') return 'D';
    if (t === 'A' || t === 'B' || t === 'C' || t === 'D') return t;
    return 'A';
}
