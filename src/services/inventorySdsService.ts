/**
 * Supplier SDS files kept with the inventory (private `inventory-sds` bucket).
 *
 * A file is uploaded into the space's folder first; the database then
 * registers it after checking the stored object, so a record never points at
 * a file the caller did not put there. One document covers every bottle of
 * the same product (matched by CAS number, or by product number and brand).
 */
import { supabase } from './supabaseClient';

export const SDS_BUCKET = 'inventory-sds';
export const SDS_MAX_BYTES = 20 * 1024 * 1024;
export const SDS_ACCEPT = 'application/pdf,image/png,image/jpeg';

const EXTENSIONS: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };
const CAS_PATTERN = /^[0-9]{2,7}-[0-9]{2}-[0-9]$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SdsDocument {
    id: string;
    labId: string | null;
    casNumber: string | null;
    brand: string | null;
    productNumber: string | null;
    fileName: string;
    objectPath: string;
    mimeType: string;
    sizeBytes: number;
    revisionDate: string | null;
    uploadedBy: string | null;
    createdAt: string;
}

export interface SdsProductKey {
    casNumber?: string | null;
    brand?: string | null;
    productNumber?: string | null;
}

export type SdsErrorCode = 'too_large' | 'unsupported_type' | 'missing_key' | 'access_denied' | 'admin_required' | 'unknown';

export class SdsError extends Error {
    readonly code: SdsErrorCode;
    constructor(code: SdsErrorCode, message: string) {
        super(message);
        this.name = 'SdsError';
        this.code = code;
    }
}

export function toSdsError(error: unknown): SdsError {
    if (error instanceof SdsError) return error;
    const message = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error ?? '');
    const code: SdsErrorCode = message.includes('INVENTORY_SDS_ADMIN_REQUIRED')
        ? 'admin_required'
        : message.includes('INVENTORY_SDS_ACCESS_DENIED') ? 'access_denied'
            : message.includes('INVENTORY_SDS_INVALID_INPUT') ? 'missing_key' : 'unknown';
    return new SdsError(code, message || 'SDS request failed.');
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const norm = (value: string | null | undefined): string => (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function normalizeSdsRow(row: unknown): SdsDocument {
    const record = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const id = text(record.id);
    const objectPath = text(record.object_path);
    if (!id || !objectPath) throw new Error('The SDS row is incomplete.');
    return {
        id,
        labId: text(record.lab_id),
        casNumber: text(record.cas_number),
        brand: text(record.brand),
        productNumber: text(record.product_number),
        fileName: text(record.file_name) ?? 'SDS',
        objectPath,
        mimeType: text(record.mime_type) ?? 'application/pdf',
        sizeBytes: Number(record.size_bytes) || 0,
        revisionDate: text(record.revision_date),
        uploadedBy: text(record.uploaded_by),
        createdAt: text(record.created_at) ?? '',
    };
}

/**
 * Documents for one product. A CAS match is enough; without one, the product
 * number must match and the brands must not contradict each other.
 */
export function matchSdsDocuments(documents: readonly SdsDocument[], key: SdsProductKey): SdsDocument[] {
    const cas = norm(key.casNumber);
    const product = norm(key.productNumber);
    const brand = norm(key.brand);
    return documents.filter((document) => {
        if (cas && norm(document.casNumber) === cas) return true;
        if (!product || norm(document.productNumber) !== product) return false;
        const documentBrand = norm(document.brand);
        return !brand || !documentBrand || documentBrand === brand;
    });
}

/** Checks a file before upload; the database checks the stored object again. */
export function validateSdsFile(file: { type: string; size: number }): void {
    if (!EXTENSIONS[file.type]) throw new SdsError('unsupported_type', 'Only PDF, PNG or JPEG files can be attached.');
    if (file.size < 1 || file.size > SDS_MAX_BYTES) throw new SdsError('too_large', 'SDS files must be 20 MB or smaller.');
}

export function sdsKeyFrom(key: SdsProductKey): { casNumber: string | null; brand: string | null; productNumber: string | null } {
    const casNumber = key.casNumber?.trim() || null;
    const productNumber = key.productNumber?.trim() || null;
    if (!productNumber && (!casNumber || !CAS_PATTERN.test(casNumber))) {
        throw new SdsError('missing_key', 'A valid CAS number or a product number is required.');
    }
    return {
        casNumber: casNumber && CAS_PATTERN.test(casNumber) ? casNumber : null,
        brand: key.brand?.trim() || null,
        productNumber,
    };
}

/** All SDS documents of the current space (lab or personal), newest first. */
export async function fetchSdsDocuments(labId: string | null): Promise<SdsDocument[]> {
    let query = supabase
        .from('inventory_sds_documents')
        .select('id,lab_id,cas_number,brand,product_number,file_name,object_path,mime_type,size_bytes,revision_date,uploaded_by,created_at');
    query = labId ? query.eq('lab_id', labId) : query.is('lab_id', null);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(1000);
    if (error) throw toSdsError(error);
    return (data || []).map(normalizeSdsRow);
}

export async function uploadSdsDocument(
    labId: string | null,
    file: File,
    key: SdsProductKey & { revisionDate?: string | null },
): Promise<SdsDocument> {
    validateSdsFile(file);
    const productKey = sdsKeyFrom(key);
    if (labId && !UUID_PATTERN.test(labId)) throw new Error('labId must be a UUID.');
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) throw new SdsError('access_denied', 'Sign in to attach SDS files.');
    const folder = labId ? labId.toLowerCase() : `u-${auth.user.id.toLowerCase()}`;
    const path = `${folder}/${crypto.randomUUID()}.${EXTENSIONS[file.type]}`;

    const { error: uploadError } = await supabase.storage.from(SDS_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
    if (uploadError) throw toSdsError(uploadError);
    const { data, error } = await supabase.rpc('create_inventory_sds_document_v1', {
        p_lab_id: labId,
        p_object_path: path,
        p_file_name: file.name.slice(0, 200) || 'SDS',
        p_cas_number: productKey.casNumber,
        p_brand: productKey.brand,
        p_product_number: productKey.productNumber,
        p_revision_date: key.revisionDate || null,
    });
    if (error) {
        // Without a record the file is unreachable; remove it rather than leave it behind.
        await supabase.storage.from(SDS_BUCKET).remove([path]).catch(() => undefined);
        throw toSdsError(error);
    }
    return normalizeSdsRow(data);
}

/** A short-lived link to view the file. */
export async function getSdsDocumentUrl(document: Pick<SdsDocument, 'objectPath'>): Promise<string> {
    const { data, error } = await supabase.storage.from(SDS_BUCKET).createSignedUrl(document.objectPath, 300);
    if (error || !data?.signedUrl) throw toSdsError(error ?? new Error('No signed URL.'));
    return data.signedUrl;
}

export async function deleteSdsDocument(id: string): Promise<void> {
    const { data, error } = await supabase.rpc('delete_inventory_sds_document_v1', { p_id: id });
    if (error) throw toSdsError(error);
    if (typeof data === 'string' && data) {
        const { error: removeError } = await supabase.storage.from(SDS_BUCKET).remove([data]);
        if (removeError) console.warn('SDS record removed but its file could not be deleted:', removeError);
    }
}
