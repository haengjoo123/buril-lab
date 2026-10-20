# 골든셋 V2 재검토 기록 (2026-10-19, AI 보조)

> **검토 성격:** 이 문서와 그에 따른 정답 변경은 **AI 보조 검토**(`ai-assisted-label-review-v1`)다. 저장된 KOSHA 지문(Section 2/3/9/10/13/15)과 현재 분석기 결과만 근거로 삼았고, 사람·법률 검토가 아니다. 변경된 모든 행에는 `labelRevisions[]`(이전 정답, 사유, 근거 Section, `humanReviewed: false`)가 남아 있다. 배포용 규제 주장으로 쓰려면 이름이 있는 사람 검토자가 아래 "사람 검토가 필요한 정책 질문"을 먼저 결정해야 한다.

재현: `npm run golden:apply-ai-review`(저장 근거만 사용, 네트워크 없음, 코호트 크기를 assert)

## 요약

| 지표 (기존 1,000행) | 이전 (main, 2026-10-19) | 이후 |
|---|---:|---:|
| strict match | 897 | 1,000 |
| conservative hold (정답 ready → 앱 보류) | 82 | 0 |
| unsafe automatic ready | 0 | 0 |
| ready stream mismatch | 0 | 0 |

공통 시약 층(5절)을 더한 전체 1,103행: strict match 1,100, conservative hold 3, unsafe automatic ready 0, ready stream mismatch 0.

불일치 103건의 처리:

| 판정 | 건수 | 처리 |
|---|---:|---|
| 앱이 맞음: 치명적 급성독성(H300/H310/H330) | 77 | 정답을 `blocked`(격리 후 SPECIAL_REVIEW 인계)로 변경 |
| 앱이 맞음: 산화성·에너지성 물질 정체 | 12 | 정답을 `needs_input` → `blocked`(REACTIVE_OXIDIZER 인계)로 변경 |
| 앱이 맞음: 미확인 산화물 | 2 | 정답을 `ready:AQUEOUS_OTHER` → `needs_input`으로 변경 |
| 정답이 맞음: 리플레이 입력 누락 | 12 | 정답 유지. 리플레이가 앱과 같은 PubChem ConnectivitySMILES를 쓰도록 수정 (사용자 승인 후 적용) |

분석기 규칙은 어느 것도 완화하지 않았다. 반응성·산화성, 시안/황화물+산, HF/불화물, 중금속 규칙은 손대지 않았다.

## 1. 치명적 급성독성 → blocked (77건)

**판단:** KOSHA Section 2가 H300(삼키면 치명적), H310(피부 접촉 시 치명적), H330(흡입 시 치명적) 중 하나 이상을 분류한다. 분석기는 이 물질을 `SPECIAL_HAZARD`로 올려 공통 폐액통에 넣지 않고 격리·인계하게 한다. 치명적 독성 물질을 공통 용기로 자동 안내하지 않는다는 보수 원칙에 따라 정답을 앱 쪽으로 바꿨다. 이 중 9건은 원래 `needs_input`(기체 제품이 액체 폐액으로 기재된 상태 충돌 8건, 불화규산 1건)이었고, 더 엄격한 `blocked`로 올렸다.

근거 Section: 2(H코드), 13(폐기 방법). 원래 adjudication은 `policy_decision`이었고 이제 `app_correct`다.

**사람이 다시 봐야 할 분류:** 아래 행은 KOSHA 분류가 EU CLP 등 다른 출처보다 훨씬 엄격해 보인다. 보수 원칙에 따라 일단 blocked로 두었지만 사람 검토자가 KOSHA 원문을 확인해야 한다.
- 0651 Sodium lauryl sulfate (H310), 0848 Isoheptyl alcohol (H330), 0860/0864/0866/0884 지방 알코올 혼합물 (H330)
- 0535 Copper dihydroxide, 0568 Cobalt hydroxide, 0613 Stannous sulfate (분진 흡입 H330)
- 0318 o-Difluorobenzene (H330), 0811 (R)-1-Hydroxy-1-phenylacetone (H330)

| 행 | CAS | 물질 | 근거 H코드 | 이전 정답 | 새 정답 / 처리 |
|---|---|---|---|---|---|
| 0005 | 74-90-8 | Hydrogen Cyanide | H300, H310, H330 | ready:CYANIDE_SULFIDE | blocked |
| 0016 | 12211-52-8 | Ammonium cyanide | H300, H310, H330 | ready:CYANIDE_SULFIDE | blocked |
| 0026 | 557-21-1 | Zinc dicyanide | H310, H330 | ready:CYANIDE_SULFIDE | blocked |
| 0027 | 107-12-0 | Propionitrile | H300, H310, H330 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0037 | 14402-89-2 | Sodium Nitroprusside | H300, H310, H330 | ready:CYANIDE_SULFIDE | blocked |
| 0053 | 75-15-0 | Carbon Disulfide | H330 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0056 | 7783-06-4 | Hydrogen Sulfide | H330 | needs_input | blocked |
| 0088 | 1344-48-5 | Cinnabar | H300, H310, H330 | ready:CYANIDE_SULFIDE | blocked |
| 0103 | 31119-53-6 | Cadmium sulphate | H330 | ready:SOLID_CONTAMINATED | blocked |
| 0106 | 1191-79-3 | Barium cadmium stearate | H330 | ready:HEAVY_METAL | blocked |
| 0124 | 1345-09-1 | Cadmium mercury sulfide | H300, H310, H330 | ready:CYANIDE_SULFIDE | blocked |
| 0130 | 1306-19-0 | Cadmium Oxide | H330 | ready:HEAVY_METAL | blocked |
| 0131 | 10124-36-4 | Cadmium Sulfate | H330 | ready:HEAVY_METAL | blocked |
| 0133 | 10108-64-2 | Cadmium Chloride | H330 | ready:HEAVY_METAL | blocked |
| 0185 | 68876-84-6 | Fatty acids, C8-18 and C18-unsatd., cadmium salts | H330 | needs_input | blocked |
| 0186 | 7439-97-6 | Mercury | H330 | ready:HEAVY_METAL | blocked |
| 0188 | 15385-58-7 | Mercurous bromide | H300, H310, H330 | ready:HEAVY_METAL | blocked |
| 0189 | 10112-91-1 | MERCURY CHLORIDE (Mercury chloride (Hg2Cl2)) | H300, H310, H330 | ready:HEAVY_METAL | blocked |
| 0194 | 12344-40-0 | Mercury silver iodide | H300, H310, H330 | ready:SOLID_CONTAMINATED | blocked |
| 0198 | 22967-92-6 | Methylmercury compounds (Methylmercury(1+)) | H310 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0199 | 7784-03-4 | Mercury disilver tetraiodide | H300, H310, H330 | ready:HEAVY_METAL | blocked |
| 0258 | 79-19-6 | Thiosemicarbazide | H300 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0260 | 2231-57-4 | Thiocarbohydrazide | H300, H330 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0264 | 497-18-7 | Carbohydrazide | H310 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0269 | 6610-29-3 | N-Methylhydrazinecarbothioamide | H300 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0295 | 57-14-7 | 1,1-Dimethylhydrazine | H330 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0305 | 640-19-7 | Fluoroacetamide | H300, H310 | ready:ORGANIC_HALOGENATED | blocked |
| 0315 | 684-16-2 | Hexafluoroacetone | H330 | needs_input | blocked |
| 0318 | 367-11-3 | 1,2-Difluorobenzene | H330 | ready:ORGANIC_HALOGENATED | blocked |
| 0321 | 16961-83-4 | Fluorosilicic acid | H310, H330 | needs_input:SPECIAL_REVIEW | blocked |
| 0328 | 3863-11-4 | 3,4-Difluoroaniline | H330 | ready:ORGANIC_HALOGENATED | blocked |
| 0343 | 453-18-9 | Methyl fluoroacetate | H310 | ready:ORGANIC_HALOGENATED | blocked |
| 0345 | 382-21-8 | Perfluoroisobutylene | H330 | needs_input | blocked |
| 0346 | 62-74-8 | Sodium Fluoroacetate | H300, H310, H330 | ready:ORGANIC_HALOGENATED | blocked |
| 0350 | 420-46-2 | 1,1,1-Trifluoroethane | H330 | needs_input | blocked |
| 0377 | 685-88-1 | Diethyl fluoromalonate | H300 | ready:ORGANIC_HALOGENATED | blocked |
| 0402 | 96-24-2 | 3-Chloro-1,2-propanediol | H300 | ready:ORGANIC_HALOGENATED | blocked |
| 0406 | 327-98-0 | Trichloronate | H300, H310 | ready:ORGANIC_HALOGENATED | blocked |
| 0407 | 78-95-5 | Chloroacetone | H310, H330 | ready:ORGANIC_HALOGENATED | blocked |
| 0411 | 126-99-8 | Chloroprene | H310 | ready:ORGANIC_HALOGENATED | blocked |
| 0419 | 1897-45-6 | Chlorothalonil | H330 | ready:ORGANIC_HALOGENATED | blocked |
| 0420 | 4109-96-0 | Dichlorosilane | H330 | needs_input | blocked |
| 0431 | 5836-73-7 | Promurit | H300 | ready:ORGANIC_HALOGENATED | blocked |
| 0432 | 12663-46-6 | Cyclochlorotine | H300 | ready:ORGANIC_HALOGENATED | blocked |
| 0442 | 109-09-1 | 2-Chloropyridine | H310 | ready:ORGANIC_HALOGENATED | blocked |
| 0453 | 79-11-8 | Chloroacetic Acid | H330 | ready:ORGANIC_HALOGENATED | blocked |
| 0461 | 87-86-5 | Pentachlorophenol | H300 | ready:ORGANIC_HALOGENATED | blocked |
| 0479 | 107-14-2 | Chloroacetonitrile | H310 | ready:ORGANIC_HALOGENATED | blocked |
| 0480 | 107-20-0 | Chloroacetaldehyde | H330 | ready:ORGANIC_HALOGENATED | blocked |
| 0482 | 111-44-4 | Dichloroethylether (Bis(2-chloroethyl) ether) | H310 | ready:ORGANIC_HALOGENATED | blocked |
| 0489 | 1825-21-4 | Pentachloroanisole | H300 | ready:ORGANIC_HALOGENATED | blocked |
| 0535 | 20427-59-2 | Copper dihydroxide | H330 | ready:HEAVY_METAL | blocked |
| 0544 | 75-59-2 | Tetramethylammonium hydroxide | H300, H310 | ready:ALKALI_AQUEOUS | blocked |
| 0568 | 21041-93-0 | Cobalt hydroxide | H330 | ready:HEAVY_METAL | blocked |
| 0607 | 77-78-1 | Dimethyl Sulfate | H330 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0611 | 7783-35-9 | Mercuric sulfate | H300, H310, H330 | ready:HEAVY_METAL | blocked |
| 0613 | 7488-55-3 | Stannous sulfate | H330 | ready:HEAVY_METAL | blocked |
| 0614 | 7446-18-6 | Thallous sulfate | H300 | ready:HEAVY_METAL | blocked |
| 0618 | 7783-36-0 | Mercurous sulfate | H300, H310, H330 | ready:HEAVY_METAL | blocked |
| 0627 | 1031-07-8 | Endosulfan Sulfate | H300 | ready:ORGANIC_HALOGENATED | blocked |
| 0651 | 151-21-3 | Sodium Lauryl Sulfate | H310 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0667 | 65-30-5 | Nicotine sulfate | H300, H310 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0668 | 2074-50-2 | Paraquat dimetilsulfate | H330 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0670 | 10031-59-1 | Thallous sulfate | H300, H330 | ready:HEAVY_METAL | blocked |
| 0681 | 51-60-5 | Neostigmine Methylsulfate | H300 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0806 | 75-86-5 | Acetone Cyanohydrin | H300, H310, H330 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0808 | 921-03-9 | 1,1,3-Trichloroacetone | H300, H330 | ready:ORGANIC_HALOGENATED | blocked |
| 0810 | 1752-30-3 | Acetone thiosemicarbazide | H300, H330 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0811 | 1798-60-3 | (R)-1-Hydroxy-1-phenylacetone | H330 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0817 | 107-18-6 | Allyl Alcohol | H310, H330 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0848 | 51774-11-9 | 5-Methyl-1-hexanol | H330 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0851 | 107-19-7 | Propargyl alcohol | H310, H330 | ready:ORGANIC_NON_HALOGENATED | blocked |
| 0860 | 68551-07-5 | Alcohols, (C=8-18) - | H330 | ready:SOLID_CONTAMINATED | blocked |
| 0864 | 90604-31-2 | Alcohols, (C=13-15) - | H330 | needs_input | blocked |
| 0866 | 68333-80-2 | Alcohols, (C=14-16) - | H330 | ready:SOLID_CONTAMINATED | blocked |
| 0884 | 68603-15-6 | ALCOHOLS, C6-12 | H330 | needs_input | blocked |
| 0905 | 681-84-5 | Tetramethoxysilane | H330 | ready:ORGANIC_NON_HALOGENATED | blocked |

## 2. 산화성·에너지성 정체 → blocked (12건)

**판단:** 이전 정답은 "이름 수준 근거만 있어 반응성이 확정되지 않았다"며 `needs_input` + 권고 REACTIVE_OXIDIZER였다. 이번에 Section 3 물질 정체를 다시 보면 과염소산염·요오드산염·과요오드산염·질산염(산화제), 유기 과산화물, 아자이드, 하이드라진이다. 이 중 6건은 Section 10이 "가열 시 용기가 폭발할 수 있음"을 기록한다. 어떤 사용자 입력으로도 공통 용기 투입이 되지 않으므로, 입력으로 풀리는 보류보다 격리 `blocked`가 맞다. 분석기의 반응성 보류는 완화하지 않는다는 규칙과도 일치한다.

근거 Section: 2(반응성 H코드 없음 확인), 3(정체), 10(반응성 서술).

| 행 | CAS | 물질 | 근거 H코드 | 이전 정답 | 새 정답 / 처리 |
|---|---|---|---|---|---|
| 0169 | 10022-68-1 | Cadmium nitrate tetrahydrate | H302, H312, H332, H350, H400, H410 | needs_input:REACTIVE_OXIDIZER | blocked |
| 0191 | 7783-32-6 | Mercuric iodate | H300, H310, H330, H373, H400, H410 | needs_input:REACTIVE_OXIDIZER | blocked |
| 0197 | 7616-83-3 | Mercuric perchlorate | H300, H310, H330, H373, H400, H410 | needs_input:REACTIVE_OXIDIZER | blocked |
| 0223 | 94-17-7 | p-Chlorobenzoyl peroxide | H302, H315, H319, H413 | needs_input:REACTIVE_OXIDIZER | blocked |
| 0225 | 3071-32-7 | Ethylbenzene hydroperoxide | — | needs_input:REACTIVE_OXIDIZER | blocked |
| 0251 | 1705-60-8 | 2,2-Di-(4,4-di-tert-butylperoxycyclohexyl)propane | — | needs_input:REACTIVE_OXIDIZER | blocked |
| 0255 | 7782-79-8 | Hydrazoic acid | H300, H319, H330, H371 | needs_input:REACTIVE_OXIDIZER | blocked |
| 0257 | 20762-60-1 | Potassium azide | H400 | needs_input:REACTIVE_OXIDIZER | blocked |
| 0298 | 13775-80-9 | Hydrazinium bromide | — | needs_input:REACTIVE_OXIDIZER | blocked |
| 0300 | 1073-69-4 | (4-Chlorophenyl)hydrazine | H300, H311, H314, H317, H318, H400 | needs_input:REACTIVE_OXIDIZER | blocked |
| 0528 | 12268-84-7 | Lead hydroxide nitrate | H302, H317, H350, H360, H373, H400, H410 | needs_input:REACTIVE_OXIDIZER | blocked |
| 0550 | 14691-87-3 | Dipotassium hydroxide periodate | — | needs_input:REACTIVE_OXIDIZER | blocked |

## 3. 미확인 산화물 → needs_input (2건)

**판단:** 산화 터븀 두 행은 이전에 "peroxide" 이명이 오래된 명칭이라는 이유로 `ready:AQUEOUS_OTHER`가 되었다. 이명 판단은 맞지만, Section 9는 고체이고 용해도 자료가 없다. 분석기는 산화물·원소 물질을 의도적으로 미분류로 남긴다. 불용성 희토류 산화물을 수용액 폐액으로 자동 안내할 근거가 없으므로 `needs_input`(권고 스트림 없음)으로 바꿨다.

근거 Section: 3, 9, 10.

| 행 | CAS | 물질 | 근거 H코드 | 이전 정답 | 새 정답 / 처리 |
|---|---|---|---|---|---|
| 0210 | 12037-01-3 | TERBIUM PEROXIDE (Terbium oxide (Tb4O7)) | — | ready:AQUEOUS_OTHER | needs_input |
| 0241 | 12738-76-0 | Terbium oxide | — | ready:AQUEOUS_OTHER | needs_input |

## 4. 리플레이 입력 누락 → 정답 유지, 리플레이 수정 (12건)

**판단:** 커밋 70c1f951(2026-08-17)은 구조식이 없을 때 "탄소+금속" 분자식을 `possible_ionic_organic_material`로 보고 분류를 보류하게 했다. 앱은 PubChem에서 `ConnectivitySMILES`를 받아 이온성 유기염을 확인하지만, 골든 리플레이는 분자식만 넘겨 앱보다 정보가 적었다. 저장된 시나리오는 이미 사용자 확인 매트릭스(수용액/유기용매)를 갖고 있으므로 정답이 맞고, 보류는 리플레이 결함이다.

**수정:** 분석기 규칙은 그대로 두고, 해당 61개 행(possible-ionic 판정 행 전체)에 PubChem ConnectivitySMILES를 저장하고 리플레이가 이를 `analyzeChemical`에 넘기도록 했다(`scripts/wasteGoldenSetV2.ts`). 시뮬레이션에서 이 12건만 ready로 바뀌었고 다른 행 변화와 unsafe ready는 없었다. ready로 바뀌는 목록은 적용 전에 사용자 승인을 받았다. 회귀 테스트: `scripts/waste-golden-v2.test.ts`의 "replays the stored PubChem structure…".

| 행 | CAS | 물질 | 근거 H코드 | 이전 정답 | 새 정답 / 처리 |
|---|---|---|---|---|---|
| 0589 | 54326-11-3 | Hydroxyaluminum benzoate stearate | — | ready:AQUEOUS_OTHER | 정답 유지, 리플레이 수정 → ready:AQUEOUS_OTHER |
| 0596 | 142-03-0 | Aluminum Subacetate | H400 | ready:AQUEOUS_OTHER | 정답 유지, 리플레이 수정 → ready:AQUEOUS_OTHER |
| 0631 | 10040-45-6 | Sodium Picosulfate | — | ready:ORGANIC_NON_HALOGENATED | 정답 유지, 리플레이 수정 → ready:ORGANIC_NON_HALOGENATED |
| 0639 | 142-87-0 | Sodium Decyl Sulfate | — | ready:ORGANIC_NON_HALOGENATED | 정답 유지, 리플레이 수정 → ready:ORGANIC_NON_HALOGENATED |
| 0643 | 142-31-4 | Sodium Octyl Sulfate | — | ready:ORGANIC_NON_HALOGENATED | 정답 유지, 리플레이 수정 → ready:ORGANIC_NON_HALOGENATED |
| 0644 | 546-74-7 | Sodium ethyl sulfate | — | ready:ORGANIC_NON_HALOGENATED | 정답 유지, 리플레이 수정 → ready:ORGANIC_NON_HALOGENATED |
| 0649 | 512-42-5 | Methyl sulfate, sodium salt | H319 | ready:ORGANIC_NON_HALOGENATED | 정답 유지, 리플레이 수정 → ready:ORGANIC_NON_HALOGENATED |
| 0650 | 1000-56-2 | Sodium propyl sulfate | — | ready:AQUEOUS_OTHER | 정답 유지, 리플레이 수정 → ready:AQUEOUS_OTHER |
| 0655 | 9004-82-4 | Sodium laureth sulfate | H302, H315, H319 | ready:ORGANIC_NON_HALOGENATED | 정답 유지, 리플레이 수정 → ready:ORGANIC_NON_HALOGENATED |
| 0691 | 126-92-1 | Sodium 2-ethylhexyl sulfate | H315, H319 | ready:ORGANIC_NON_HALOGENATED | 정답 유지, 리플레이 수정 → ready:ORGANIC_NON_HALOGENATED |
| 0704 | 870-72-4 | Sodium Formaldehyde Bisulfite | H315 | ready:ORGANIC_NON_HALOGENATED | 정답 유지, 리플레이 수정 → ready:ORGANIC_NON_HALOGENATED |
| 0706 | 149-44-0 | Rongalite | — | ready:ORGANIC_NON_HALOGENATED | 정답 유지, 리플레이 수정 → ready:ORGANIC_NON_HALOGENATED |

## 사람 검토가 필요한 정책 질문

1. **시안화물 전용 스트림과 치명적 독성.** 무기 시안화염 19건(NaCN, KCN 등, 모두 H300/H310/H330)은 분석기가 시안 분류를 치명적 독성보다 먼저 적용해 `ready:CYANIDE_SULFIDE`로 안내하고, 정답도 같다. 시안 전용 폐액통은 일반 공통 용기가 아니므로 이번에 바꾸지 않았다. 반면 HCN·시안화 암모늄·시안화 아연 등은 분자식상 유기물로 판정되거나 이름 패턴(DICYANIDE, 시아니드)에 걸리지 않아 치명적 독성 규칙으로 blocked가 된다. 같은 계열 안에서 결과가 갈리므로 기관 정책 결정이 필요하다.
2. **KOSHA 원물질 분류와 묽은 폐액.** KOSHA는 황산을 H330(미스트 흡입), 염화수소를 기체(H280)로 분류한다. 현재 규칙으로는 가장 흔한 묽은 산 폐액도 자동 안내되지 않는다. 농도에 따른 독성 판단은 이번 범위 밖이며, 공통 시약 층이 이 문제를 드러내도록 정답을 보수적으로 두었다(아래 5절).
3. **약산·약염기 염의 산/알칼리 스트림.** 앱은 붕산, KH2PO4, 탄산수소나트륨 등을 이름·분자식으로 산/알칼리 스트림에 보낸다. 법적 폐산·폐알칼리(pH ≤ 2 / ≥ 12.5)보다 넓지만 더 분리된 쪽이라 안전 문제는 아니다.

## 5. 공통 실험실 시약 층 `common_lab_reagent` (103행)

**목적:** 기존 1,000행은 산업용 카드뮴염 등에 치우쳐 실제 실험실에서 흔한 시약이 거의 없었다. 산·염기, 용매, 완충액·분자생물 시약, 중금속·산화제, 금수성·에너지성 시약 115종을 CAS로 KOSHA에서 조회했고, 이미 V2에 있던 10종과 KOSHA 기록이 없는 2종(DTT, PMSF)을 빼고 103행을 추가했다.

**수집:** `npm run golden:add-common-reagents` (`scripts/add-waste-golden-v2-common-reagents.mjs`). KOSHA 수집 동결 가드를 그대로 따르며, 사용자가 KOSHA 서면 허가를 확인한 뒤 이번 로컬 실행에만 `KOSHA_BULK_COLLECTION_ACK`를 설정했다. CI에서는 실행하지 않는다. 기존 행과 같은 스키마로 Section 2/3/9/10/13/15 짧은 지문과 SHA-256 지문만 저장하며, SDS 원문·HTML은 저장하지 않는다(HTML은 지문만). PubChem은 분자식·이름과, 이온성 유기염일 때 ConnectivitySMILES만 보조로 쓴다.

**정답 결정 방식:** 분석기 결과를 복사하지 않았다. 스크립트에 각 시약의 표준 실험실 폐기 시나리오(수용액/유기용매/고체)와 정체 역할(산·염기·산화제·불화물·확인 필요)을 명시하고, KOSHA H코드와 함께 다음 순서로 정답을 정한다: 반응성·산화성 H코드 또는 산화제 정체 → blocked, 치명적 급성독성 → blocked, 불화물 → needs_input(SPECIAL_REVIEW 권고), 기체 제품의 액체 폐액 → needs_input, 중금속 → HEAVY_METAL, 고체 → SOLID_CONTAMINATED, 유기 할로겐 → ORGANIC_HALOGENATED, 유기용매 → ORGANIC_NON_HALOGENATED, 수용액 산/염기 → ACID/ALKALI_AQUEOUS, 그 외 수용액 → AQUEOUS_OTHER. 정답은 AI 보조 검토로 기록했다(`review.reviewerId: ai-assisted-label-review-v1`). 저장된 근거만으로 다시 계산하려면 `V2_COMMON_REAGENTS_RELABEL_ONLY=1 npm run golden:add-common-reagents`(네트워크 없음).

**결과:** 103행 중 100행 strict match, unsafe automatic ready 0, ready stream mismatch 0. 보수적 보류 3건(크실렌 혼합물, Triton X-100, Tween 20)은 PubChem에 단일 분자식이 없는 혼합물이라 분석기가 분류를 보류한다. 정당한 보류이므로 분석기를 완화하지 않았다.

**이 층이 드러낸 점(정답에 메모로 기록):**
- 황산(H330), 질산(H271, H330), 포름알데하이드·글루타르알데하이드(H330), 에티디움 브로마이드(H330), 2-머캅토에탄올(H330), 브롬(H330)은 KOSHA 원물질 분류 때문에 blocked다. 묽은 실험 폐액에는 과도할 수 있어 사람 정책 결정이 필요하다(정책 질문 2).
- 7647-01-0의 KOSHA 기록은 염산 용액이 아니라 무수 염화수소 기체여서 기존 상태 충돌 규칙에 따라 needs_input이다.
- 탄산나트륨·탄산수소나트륨: PubChem SMILES가 있으면 탄산 이온이 "이온성 유기염"으로 판정되어 알칼리 정체가 사라지는 **분석기 버그**를 찾았다. 탄산·시안 같은 무기 탄소 이온은 이온성 유기염 판정에서 제외하도록 고쳤고(강화 방향), 단위 테스트를 추가했다. 기존 1,000행 결과는 변하지 않았다.
- Tris-HCl·구아니딘 염산염은 염산염의 Cl 때문에 앱이 할로겐 유기 폐액으로 보냈다. **후속 수정:** 이름이 분자식의 할로겐 전부를 염산염(hydrohalide) 짝이온으로 밝히고 질소 염기가 있으면 이온성 유기염으로 보아 수용액 폐액은 AQUEOUS_OTHER로 보낸다. 짝이온 외 할로겐이 남으면(예: 2-클로로에틸아민 염산염) 할로겐 유기 경로를 유지한다. 정답도 AQUEOUS_OTHER로 바로잡았다(스크립트 역할 `hydrohalide`).
- EDTA는 한글 이름의 "아세트산" 부분 문자열로 산 정체가 잡혔다(Tween 20의 "모노로레인산"도 "인산"에, "염산 구아니딘"도 "염산"에 걸렸다). **후속 수정:** 한글 산 이름은 독립된 단어일 때만 산 정체로 본다. "진한 황산", "염산 수용액", "황산 98%"처럼 농도·용액 표현은 그대로 산이므로 이름만 있는 실제 산의 산+시안/황화물 차단 규칙은 유지되고 단위 테스트로 고정했다. EDTA 유리산은 CAS(60-00-4)로 산 정체를 유지해 정답 ACID_AQUEOUS는 바뀌지 않았다.
- 구아니딘 티오시아네이트(RNA 추출 시약)는 유기 양이온 티오시아네이트라 앱이 시안 계열로 보지 않고 AQUEOUS_OTHER로 안내했다. **후속 수정(강화 방향):** 유기 양이온 티오시아네이트 염(이름 "<양이온> thiocyanate" 또는 PubChem SMILES의 분리된 SCN⁻ 조각)에 CYANIDE 플래그를 붙여 CYANIDE_SULFIDE 스트림으로 보내고 산과 섞으면 차단한다. 공유결합 R-SCN 에스터와 금속 티오시아나토 착물은 기존 경로를 유지한다. 정답도 CYANIDE_SULFIDE로 바꿨다(스크립트 역할 `cyanide`).
- 붕산·KH2PO4(산), Na2HPO4·NaHCO3(알칼리)는 앱 정책대로 산/알칼리 스트림이다(정책 질문 3).

| 행 | CAS | 물질 | 시나리오 | 정답 | 앱 결과 |
|---|---|---|---|---|---|
| 1001 | 7647-01-0 | Hydrochloric Acid | 기체→액체 충돌 | needs_input | 일치 |
| 1002 | 7664-93-9 | Sulfuric Acid | aqueous_solution | blocked | 일치 |
| 1003 | 7697-37-2 | Nitric Acid | aqueous_solution | blocked | 일치 |
| 1004 | 7664-38-2 | Phosphoric Acid | aqueous_solution | ready:ACID_AQUEOUS | 일치 |
| 1005 | 64-19-7 | Acetic Acid | aqueous_solution | ready:ACID_AQUEOUS | 일치 |
| 1006 | 7664-39-3 | Hydrofluoric Acid | 기체→액체 충돌 | blocked | 일치 |
| 1007 | 64-18-6 | Formic Acid | aqueous_solution | ready:ACID_AQUEOUS | 일치 |
| 1008 | 7601-90-3 | Perchloric Acid | aqueous_solution | blocked | 일치 |
| 1009 | 76-03-9 | Trichloroacetic Acid | aqueous_solution | ready:ACID_AQUEOUS | 일치 |
| 1010 | 77-92-9 | Citric Acid | aqueous_solution | ready:ACID_AQUEOUS | 일치 |
| 1011 | 144-62-7 | Oxalic Acid | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1012 | 10043-35-3 | Boric Acid | aqueous_solution | ready:ACID_AQUEOUS | 일치 |
| 1013 | 1336-21-6 | Ammonium Hydroxide | aqueous_solution | ready:ALKALI_AQUEOUS | 일치 |
| 1014 | 497-19-8 | Sodium Carbonate | aqueous_solution | ready:ALKALI_AQUEOUS | 일치 |
| 1015 | 144-55-8 | Sodium Bicarbonate | aqueous_solution | ready:ALKALI_AQUEOUS | 일치 |
| 1016 | 64-17-5 | Ethanol | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1017 | 75-05-8 | Acetonitrile | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1018 | 110-54-3 | Hexane | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1019 | 141-78-6 | Ethyl Acetate | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1020 | 108-88-3 | Toluene | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1021 | 1330-20-7 | Xylene (혼합물) | organic_solution | ready:ORGANIC_NON_HALOGENATED | needs_input (classification) |
| 1022 | 67-68-5 | Dimethyl Sulfoxide | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1023 | 68-12-2 | Dimethylformamide | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1024 | 109-99-9 | Tetrahydrofuran | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1025 | 60-29-7 | Diethyl Ether | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1026 | 110-86-1 | Pyridine | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1027 | 121-44-8 | Triethylamine | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1028 | 71-43-2 | Benzene | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1029 | 110-82-7 | Cyclohexane | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1030 | 142-82-5 | Heptane | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1031 | 109-66-0 | Pentane | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1032 | 123-91-1 | 1,4-Dioxane | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1033 | 1634-04-4 | tert-Butyl methyl ether | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1034 | 872-50-4 | N-methyl-2-pyrrolidone | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1035 | 100-41-4 | Ethylbenzene | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1036 | 78-93-3 | Methyl Ethyl Ketone | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1037 | 108-10-1 | Methyl Isobutyl Ketone | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1038 | 110-89-4 | Piperidine | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1039 | 107-15-3 | Ethylenediamine | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1040 | 7087-68-5 | Diisopropylethylamine | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1041 | 110-18-9 | N,N,N',N'-Tetramethylethylenediamine | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1042 | 100-66-3 | Anisole | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1043 | 107-21-1 | Ethylene Glycol | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1044 | 108-95-2 | Phenol | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1045 | 62-53-3 | Aniline | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1046 | 75-12-7 | Formamide | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1047 | 108-24-7 | Acetic Anhydride | organic_solution | ready:ORGANIC_NON_HALOGENATED | 일치 |
| 1048 | 75-09-2 | Dichloromethane | organic_solution | ready:ORGANIC_HALOGENATED | 일치 |
| 1049 | 67-66-3 | Chloroform | organic_solution | ready:ORGANIC_HALOGENATED | 일치 |
| 1050 | 56-23-5 | Carbon Tetrachloride | organic_solution | ready:ORGANIC_HALOGENATED | 일치 |
| 1051 | 107-06-2 | 1,2-Dichloroethane | organic_solution | ready:ORGANIC_HALOGENATED | 일치 |
| 1052 | 79-01-6 | Trichloroethylene | organic_solution | ready:ORGANIC_HALOGENATED | 일치 |
| 1053 | 74-88-4 | Methyl iodide | organic_solution | ready:ORGANIC_HALOGENATED | 일치 |
| 1054 | 50-00-0 | Formaldehyde | aqueous_solution | blocked | 일치 |
| 1055 | 111-30-8 | Glutaraldehyde | aqueous_solution | blocked | 일치 |
| 1056 | 1239-45-8 | Ethidium Bromide | aqueous_solution | blocked | 일치 |
| 1057 | 60-24-2 | 2-Mercaptoethanol | aqueous_solution | blocked | 일치 |
| 1058 | 593-84-0 | Guanidine thiocyanate | aqueous_solution | ready:CYANIDE_SULFIDE | 일치 |
| 1059 | 50-01-1 | Guanidine Hydrochloride | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1060 | 57-13-6 | Urea | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1061 | 288-32-4 | Imidazole | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1062 | 60-00-4 | Ethylenediaminetetraacetic Acid | aqueous_solution | ready:ACID_AQUEOUS | 일치 |
| 1063 | 6381-92-6 | Edta disodium | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1064 | 77-86-1 | Tris | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1065 | 1185-53-1 | Tromethamine hydrochloride | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1066 | 7365-45-9 | HEPES | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1067 | 56-81-5 | Glycerol | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1068 | 127-09-3 | Sodium Acetate | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1069 | 9002-93-1 | Triton X-100 (옥토시놀) | aqueous_solution | ready:AQUEOUS_OTHER | needs_input (classification) |
| 1070 | 9005-64-5 | Polysorbate 20 (Tween 20) | aqueous_solution | ready:AQUEOUS_OTHER | needs_input (classification) |
| 1071 | 7647-14-5 | Sodium Chloride | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1072 | 7447-40-7 | Potassium Chloride | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1073 | 7786-30-3 | Magnesium Chloride | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1074 | 10043-52-4 | Calcium Chloride | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1075 | 7558-79-4 | Sodium Phosphate, Dibasic | aqueous_solution | ready:ALKALI_AQUEOUS | 일치 |
| 1076 | 7778-77-0 | Monobasic potassium phosphate | aqueous_solution | ready:ACID_AQUEOUS | 일치 |
| 1077 | 12125-02-9 | Ammonium Chloride | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1078 | 7772-98-7 | Sodium Thiosulfate | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1079 | 7681-82-5 | Sodium Iodide | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1080 | 7681-11-0 | Potassium Iodide | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1081 | 7705-08-0 | 염화 제2철, 고체, 무수 (Iron chloride (FeCl3)) | aqueous_solution | ready:AQUEOUS_OTHER | 일치 |
| 1082 | 7553-56-2 | Iodine | aqueous_solution | needs_input | 일치 |
| 1083 | 7487-94-7 | Mercuric Chloride | aqueous_solution | blocked | 일치 |
| 1084 | 7761-88-8 | Silver Nitrate | aqueous_solution | blocked | 일치 |
| 1085 | 10099-74-8 | Lead nitrate | aqueous_solution | blocked | 일치 |
| 1086 | 7722-64-7 | Potassium Permanganate | aqueous_solution | blocked | 일치 |
| 1087 | 7778-50-9 | Potassium Dichromate | aqueous_solution | blocked | 일치 |
| 1088 | 7681-52-9 | Sodium Hypochlorite | aqueous_solution | blocked | 일치 |
| 1089 | 7632-00-0 | Sodium Nitrite | aqueous_solution | blocked | 일치 |
| 1090 | 7757-79-1 | Potassium Nitrate | aqueous_solution | blocked | 일치 |
| 1091 | 7646-85-7 | Zinc Chloride | aqueous_solution | ready:HEAVY_METAL | 일치 |
| 1092 | 7718-54-9 | Nickel Dichloride | aqueous_solution | ready:HEAVY_METAL | 일치 |
| 1093 | 7646-79-9 | Cobalt chloride | aqueous_solution | ready:HEAVY_METAL | 일치 |
| 1094 | 10361-37-2 | Barium chloride | aqueous_solution | ready:HEAVY_METAL | 일치 |
| 1095 | 20816-12-0 | Osmium Tetroxide | aqueous_solution | blocked | 일치 |
| 1096 | 16940-66-2 | Sodium borohydride | solid_residue | blocked | 일치 |
| 1097 | 109-72-8 | Butyllithium | organic_solution | blocked | 일치 |
| 1098 | 7440-23-5 | Sodium | solid_residue | blocked | 일치 |
| 1099 | 7646-69-7 | Sodium hydride | solid_residue | blocked | 일치 |
| 1100 | 16853-85-3 | Lithium aluminum hydride | solid_residue | blocked | 일치 |
| 1101 | 88-89-1 | Picric Acid | solid_residue | blocked | 일치 |
| 1102 | 1313-82-2 | Sodium sulfide | aqueous_solution | blocked | 일치 |
| 1103 | 7726-95-6 | Bromine | aqueous_solution | blocked | 일치 |
