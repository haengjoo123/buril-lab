import { createClient } from '@supabase/supabase-js';
import {
  getPredictedPhForRouting,
  predictAqueousPh,
} from '../../../src/features/phPrediction';
import type {
  WasteBatchDraft,
  WasteComponent,
  WasteHazardFlag,
  WasteMatrix,
} from '../../../src/types';
import type {
  WasteHandlingRpcComponent,
  WastePhPredictionAuthorizationContext,
} from '../../../src/services/wasteLogService';
import { getWasteAcidBasePresence } from '../../../src/utils/wasteBatch';

interface Env {
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

type PagesFunction<E = Env> = (context: {
  request: Request;
  env: E;
}) => Response | Promise<Response>;

const MAX_REQUEST_BYTES = 256 * 1024;
const AUTHORIZATION_TTL_MS = 10 * 60 * 1_000;
const VALID_MATRICES = new Set<WasteMatrix>([
  'aqueous',
  'organic_non_halogenated',
  'organic_halogenated',
  'mixed_biphasic',
  'solid_slurry',
  'unknown',
]);
const VALID_HAZARDS = new Set<WasteHazardFlag>([
  'FLAMMABLE', 'OXIDIZER', 'EXPLOSIVE', 'SELF_REACTIVE', 'WATER_REACTIVE',
  'PYROPHORIC', 'CORROSIVE', 'ACUTE_TOXIC', 'CMR', 'ENVIRONMENTAL_HAZARD',
  'CYANIDE', 'SULFIDE', 'HEAVY_METAL', 'HYDROFLUORIC_ACID', 'FLUORIDE',
  'REACTIVE', 'UNKNOWN_COMPONENT',
]);
const VALID_CATEGORIES = new Set([
  'ACID', 'ALKALI', 'CYANIDE', 'HEAVY_METAL', 'ORGANIC_HALOGEN',
  'ORGANIC_NON_HALOGEN', 'REACTIVE', 'SPECIAL_HAZARD', 'SOLID_WASTE',
  'NEUTRAL', 'UNKNOWN',
]);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getSupabaseConfig(env: Env): { url: string; anonKey: string; serviceRoleKey: string } | null {
  const url = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.SUPABASE_ANON_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && anonKey && serviceRoleKey ? { url, anonKey, serviceRoleKey } : null;
}

function reconstructComponent(component: WasteHandlingRpcComponent): WasteComponent {
  const analysis = asRecord(component.analysisSnapshot) ?? {};
  const predictionInput = asRecord(analysis.phPredictionInput) ?? {};
  const rawGhs = asRecord(analysis.ghs);
  const rawContext = asRecord(analysis.solutionContext);
  const rawVolume = asRecord(predictionInput.solutionVolume);
  const rawDensity = asRecord(predictionInput.density);
  const rawConcentration = asRecord(component.concentration);
  const concentrationUnit = rawConcentration?.unit;
  const concentrationValue = optionalFiniteNumber(rawConcentration?.value);
  const solutionVolumeValue = optionalFiniteNumber(rawVolume?.value);
  const solutionVolumeUnit = rawVolume?.unit;
  const normalizedMl = optionalFiniteNumber(rawVolume?.normalizedMl);
  const matrixCategory = optionalString(analysis.category) ?? 'UNKNOWN';
  const category = VALID_CATEGORIES.has(matrixCategory) ? matrixCategory : 'UNKNOWN';
  const ghsDataStatus = component.ghsDataStatus === 'verified'
    || component.ghsDataStatus === 'lookup_failed'
    || component.ghsDataStatus === 'not_checked'
    ? component.ghsDataStatus
    : 'not_checked';
  const hazardFlags = component.hazardFlags.filter((flag): flag is WasteHazardFlag => VALID_HAZARDS.has(flag as WasteHazardFlag));
  const pHCatalogId = optionalString(predictionInput.phCatalogId);
  const referencePh = optionalFiniteNumber(analysis.referencePh);
  const solventClass = rawContext?.solventClass;
  const physicalForm = rawContext?.physicalForm;
  const solutionContext: WasteComponent['solutionContext'] = (
    (solventClass === 'aqueous' || solventClass === 'organic_non_halogen'
      || solventClass === 'organic_halogen' || solventClass === 'mixed_or_unknown'
      || solventClass === 'organic_unknown')
    && (physicalForm === 'aqueous' || physicalForm === 'organic_solvent'
      || physicalForm === 'mixed_or_unknown')
  ) ? {
      solventClass: solventClass as NonNullable<WasteComponent['solutionContext']>['solventClass'],
      physicalForm: physicalForm as NonNullable<WasteComponent['solutionContext']>['physicalForm'],
      isSolventVerified: rawContext?.isSolventVerified === true,
      solventResolution: rawContext?.solventResolution === 'local_dictionary'
        || rawContext?.solventResolution === 'user'
        || rawContext?.solventResolution === 'unresolved'
        ? rawContext.solventResolution as NonNullable<WasteComponent['solutionContext']>['solventResolution']
        : 'unresolved' as const,
      ...(optionalString(rawContext?.solventCasNumber)
        ? { solventCasNumber: optionalString(rawContext?.solventCasNumber) }
        : {}),
    } : undefined;

  return {
    cartLineId: component.cartLineId,
    sourceType: 'manual',
    identityConfidence: component.identityConfidence >= 1 ? 'verified' : 'unknown',
    identityConfirmedByUser: analysis.identityConfirmedByUser === true,
    ghsDataStatus,
    hazardDataConfirmedByUser: analysis.hazardDataConfirmedByUser === true,
    capturedAt: component.dataSources[0]?.capturedAt || new Date(0).toISOString(),
    hazardFlags,
    ...(pHCatalogId ? { phCatalogId: pHCatalogId } : {}),
    ...(solutionVolumeValue !== undefined
      && normalizedMl !== undefined
      && (solutionVolumeUnit === 'uL' || solutionVolumeUnit === 'mL' || solutionVolumeUnit === 'L')
      ? {
          solutionVolume: {
            value: solutionVolumeValue,
            unit: solutionVolumeUnit,
            normalizedMl,
            isEstimate: rawVolume?.isEstimate === true,
          },
        }
      : {}),
    ...(concentrationValue !== undefined
      && (concentrationUnit === 'M' || concentrationUnit === 'mM'
        || concentrationUnit === '%' || concentrationUnit === 'mg/mL')
      ? {
          concentration: {
            value: concentrationValue,
            unit: concentrationUnit,
            ...(predictionInput.concentrationBasis === 'w_w'
              || predictionInput.concentrationBasis === 'w_v'
              || predictionInput.concentrationBasis === 'v_v'
              ? { basis: predictionInput.concentrationBasis }
              : {}),
            ...(optionalFiniteNumber(rawDensity?.value) !== undefined
              && rawDensity?.unit === 'g/mL'
              && (rawDensity?.kind === 'solution' || rawDensity?.kind === 'solute')
              ? {
                  density: {
                    value: optionalFiniteNumber(rawDensity?.value)!,
                    unit: 'g/mL',
                    kind: rawDensity.kind,
                    ...(optionalFiniteNumber(rawDensity?.temperatureC) !== undefined
                      ? { temperatureC: optionalFiniteNumber(rawDensity?.temperatureC) }
                      : {}),
                    ...(rawDensity?.source === 'catalog' || rawDensity?.source === 'user'
                      ? { source: rawDensity.source }
                      : {}),
                    isEstimate: rawDensity?.isEstimate === true,
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(solutionContext ? { solutionContext } : {}),
    chemical: {
      id: pHCatalogId || component.casNumber || component.cartLineId,
      name: component.chemicalName,
      casNumber: component.casNumber || '',
      molecularFormula: component.formula || '',
      ...(optionalFiniteNumber(component.molecularWeight) !== undefined
        ? { molecularWeight: optionalFiniteNumber(component.molecularWeight) }
        : {}),
      ghs: rawGhs ? {
        signal: optionalString(rawGhs.signal) || 'Warning',
        hazardStatements: Array.isArray(rawGhs.hazardStatements)
          ? rawGhs.hazardStatements.filter((statement): statement is string => typeof statement === 'string')
          : [],
      } : undefined,
      properties: {
        isHalogenated: false,
        isOrganic: false,
        ...(referencePh !== undefined ? { referencePh } : {}),
      },
    },
    category: category as WasteComponent['category'],
    binColor: '',
    label: '',
    reason: '',
    isSafe: true,
  };
}

function reconstructBatch(context: WastePhPredictionAuthorizationContext): WasteBatchDraft {
  if (!Array.isArray(context.components) || context.components.length === 0 || context.components.length > 100) {
    throw new Error('A predicted pH authorization requires between 1 and 100 components.');
  }
  if (!VALID_MATRICES.has(context.matrix)) throw new Error('The waste matrix is invalid.');
  const amount = context.totalAmount;
  const totalValue = optionalFiniteNumber(amount?.value);
  const totalUnit = amount?.unit === 'mL' || amount?.unit === 'L' ? amount.unit : null;
  const normalizedValue = totalValue !== undefined && totalUnit
    ? totalUnit === 'L' ? totalValue * 1_000 : totalValue
    : null;
  const mixingState = context.confirmationSnapshot?.mixingState;
  const incidentContext = context.confirmationSnapshot?.incidentContext;

  return {
    id: 'server-predicted-ph',
    scopeKey: 'server',
    components: context.components.map(reconstructComponent),
    matrix: context.matrix,
    matrixSource: context.confirmationSnapshot?.matrixSource === 'automatic'
      || context.confirmationSnapshot?.matrixSource === 'user'
      ? context.confirmationSnapshot.matrixSource
      : 'unresolved',
    totalAmount: {
      value: totalValue ?? null,
      unit: totalUnit,
      normalizedValue,
      normalizedUnit: normalizedValue === null ? null : 'mL',
      isApproximate: amount?.approximate === true,
      isUnknown: amount?.unknown === true,
    },
    measuredPhStatus: 'unknown',
    mixingState: mixingState === 'already_mixed' || mixingState === 'separate' ? mixingState : 'unknown',
    ...(context.confirmationSnapshot?.additionalComponentsStatus === 'none'
      || context.confirmationSnapshot?.additionalComponentsStatus === 'present'
      || context.confirmationSnapshot?.additionalComponentsStatus === 'unknown'
      ? { additionalComponentsStatus: context.confirmationSnapshot.additionalComponentsStatus }
      : {}),
    incidentContext: incidentContext === 'broken' || incidentContext === 'leak' ? incidentContext : 'none',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  if (Number(request.headers.get('content-length') || '0') > MAX_REQUEST_BYTES) {
    return json({ error: 'Request is too large.' }, 413);
  }
  const config = getSupabaseConfig(env);
  if (!config) return json({ error: 'Predicted pH authorization is not configured.' }, 503);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Authentication is required.' }, 401);

  let body: { context?: unknown };
  try {
    body = await request.json() as { context?: unknown };
  } catch {
    return json({ error: 'Request must contain JSON.' }, 400);
  }
  const context = asRecord(body.context) as unknown as WastePhPredictionAuthorizationContext | null;
  if (!context) return json({ error: 'A predicted pH authorization context is required.' }, 400);

  try {
    const userClient = createClient(config.url, config.anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userResult, error: userError } = await userClient.auth.getUser();
    if (userError || !userResult.user) return json({ error: 'Authentication is required.' }, 401);

    const batch = reconstructBatch(context);
    const acidBasePresence = getWasteAcidBasePresence(batch.components);
    if (!acidBasePresence.hasAcid || !acidBasePresence.hasAlkali) {
      return json({ error: 'Predicted pH routing is limited to aqueous acid/alkali mixtures.' }, 422);
    }
    const prediction = predictAqueousPh(batch);
    if (getPredictedPhForRouting(prediction) === undefined) {
      return json({
        error: 'This batch does not have a routing-eligible predicted pH.',
        prediction,
      }, 422);
    }

    const { data: inputFingerprint, error: fingerprintError } = await userClient.rpc(
      'waste_ph_prediction_fingerprint',
      {
        p_components: context.components,
        p_matrix: context.matrix,
        p_total_amount: context.totalAmount,
        p_confirmation: context.confirmationSnapshot,
      },
    );
    if (fingerprintError || typeof inputFingerprint !== 'string' || !inputFingerprint) {
      throw new Error('Could not bind the predicted pH authorization to this batch.');
    }

    const expiresAt = new Date(Date.now() + AUTHORIZATION_TTL_MS).toISOString();
    const adminClient = createClient(config.url, config.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authorizationRow, error: insertError } = await adminClient
      .from('waste_ph_prediction_authorizations')
      .insert({
        user_id: userResult.user.id,
        input_fingerprint: inputFingerprint,
        prediction_snapshot: prediction,
        expires_at: expiresAt,
      })
      .select('id')
      .single();
    if (insertError || !authorizationRow?.id) {
      throw new Error('Could not issue the predicted pH authorization.');
    }

    return json({
      authorizationId: authorizationRow.id,
      expiresAt,
      prediction,
    });
  } catch (error) {
    console.error('Predicted pH authorization failed:', error);
    return json({ error: 'Could not authorize predicted pH routing.' }, 500);
  }
};
