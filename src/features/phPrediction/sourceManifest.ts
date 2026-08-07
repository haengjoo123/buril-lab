/**
 * Source and licensing manifest for the reviewed offline catalog.
 *
 * Numeric equilibrium constants are scientific facts. No expressive text or
 * database rows from the non-commercial IUPAC compilation are distributed.
 */
export const PH_CATALOG_SOURCE_MANIFEST = Object.freeze({
    catalogVersion: 'buril-ph-2026.08.2',
    generatedAt: '2026-08-04',
    sources: Object.freeze([
        Object.freeze({
            id: 'USGS-PHREEQC-3.8.8',
            title: 'PHREEQC 3.8.8-17347 aqueous databases',
            releaseTag: 'v3.8.8',
            releaseCommit: 'cafc3530d40c7b098ebb9c32f56383ccba6a3856',
            url: 'https://github.com/phreeqc-dev/phreeqc3/releases/tag/v3.8.8',
            databaseArtifacts: Object.freeze([
                Object.freeze({
                    path: 'database/phreeqc.dat',
                    sha256: 'c0f7a13b5bb2b5b6e1251953f57292e993ff0850f3c01782d23094f24ae2d499',
                }),
                Object.freeze({
                    path: 'database/wateq4f.dat',
                    sha256: '93547b0343d9f151e73fb48e7927aa9e9c777399fedcb8c7497d00371af4d0ae',
                }),
                Object.freeze({
                    path: 'database/minteq.v4.dat',
                    sha256: '4a48bf5c357b3da3084606a5e322426c3ab1e969dd1c86f9c62a3a7995836ca3',
                }),
            ]),
            rights: 'United States Government work; public-domain software/data distribution.',
            use: 'Primary cross-check for inorganic aqueous protonation constants.',
        }),
        Object.freeze({
            id: 'NIST-JPCRD-BUFFERS-2002',
            title: 'Thermodynamic Quantities for the Ionization Reactions of Buffers',
            releaseTag: 'JPCRD-31-2-2002',
            url: 'https://www.nist.gov/publications/thermodynamic-quantities-ionization-reactions-buffers',
            doi: '10.1063/1.1416902',
            artifactSha256: '8b10624546d35856b7e88c2c8e94e498c11d58df55c6815d8a3a82eecf9b9cf2',
            rights: 'Scientific facts selected from a U.S. Government-authored reference publication; no expressive tables are redistributed.',
            use: 'Evaluated 298.15 K, infinite-dilution molality-standard pKa values and exact-form cross-checks.',
        }),
        Object.freeze({
            id: 'NIST-JRES-STANDARD-BUFFERS-1962',
            title: 'Revised Standard Values for pH Measurements from 0 to 95 C',
            releaseTag: 'JRES-66A-1962',
            url: 'https://nvlpubs.nist.gov/nistpubs/jres/066/2/V66.N02.A06.pdf',
            doi: '10.6028/jres.066A.015',
            artifactSha256: 'd3f25e6eaa5a99286bd93410096189d93363c6443ba4a39a3f2f34e4cd2bbee4',
            rights: 'U.S. Government-authored NBS/NIST reference publication; numeric certified buffer values only.',
            use: 'Independent 25 C certified phosphate-buffer pH validation, separate from PHREEQC.',
        }),
        Object.freeze({
            id: 'PUBCHEM-PUG-REST-2026-08-04',
            title: 'PubChem PUG REST exact-form identity snapshot',
            releaseTag: 'retrieved-2026-08-04',
            url: 'https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest',
            snapshotPath: 'src/features/phPrediction/identityData.ts',
            snapshotSha256: 'ddd81522a9df4b9904eb47c5ddca09e54e8f2df58862a7029389466edcdb534d',
            rights: 'NCBI/PubChem public chemical identifiers; attribution and retrieval date retained.',
            use: 'CAS-to-CID and Standard InChIKey identity cross-check only; not an equilibrium-constant source.',
        }),
        Object.freeze({
            id: 'BURIL-CURATED-25C-2026-08',
            title: 'Buril Lab independently reviewed 25 C aqueous acid/base constants',
            releaseTag: '2026.08.1',
            url: 'https://goldbook.iupac.org/terms/view/P04524',
            rights: 'Buril Lab catalog structure and provisional review metadata.',
            use: 'Provisional conditional values awaiting an independently pinned primary source; never eligible for good confidence.',
        }),
    ]),
    excludedSources: Object.freeze([
        Object.freeze({
            id: 'IUPAC-DISSOCIATION-CONSTANTS-V2.3E',
            reason: 'CC BY-NC 4.0 is not compatible with the intended commercial distribution; validation reference only.',
        }),
        Object.freeze({
            id: 'WILLIAMS-PKA-COMPILATION',
            reason: 'Mixed solvents and incomplete condition metadata; candidate discovery and human cross-check only.',
        }),
    ]),
    reviewPolicy: Object.freeze({
        temperatureC: 25,
        solvent: 'water',
        requiresCompleteProtonationLadder: true,
        requiresMassAndChargeReview: true,
        goldenSubsetRequiresSolverMassClosure: true,
        runtimeNetworkLookup: false,
        approvalMode: 'derived_from_pinned_evidence',
        scientificGoldenSetRequired: true,
        recordApprovalRequiresGoldenCoverage: true,
        provisionalPkaAllowedForPrediction: false,
        maximumGoldenErrorPh: 0.1,
        minimumPassingGoldenCases: 42,
        requiredCoverageTags: Object.freeze([
            'strong_acid',
            'strong_base',
            'weak_buffer',
            'polyprotic',
            'amphoteric',
            'near_neutral',
        ]),
        /** Human review remains useful, but cannot replace any machine gate. */
        manualReviewIsSupplementary: true,
    }),
});

export type PhCatalogSourceManifest = typeof PH_CATALOG_SOURCE_MANIFEST;
