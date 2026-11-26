# 실험 도구 구현·사용성 검토

검토일: 2026-11-09. 아래는 공식 제품 안내와 원자료에서 확인한 흐름을 Buril Lab의 범위에 맞게 적용한 기록이다. 특정 제품이 객관적으로 가장 우수하다고 단정하거나, 방문하지 않은 유료 화면을 직접 조작했다고 간주하지 않는다. Lab Laps 화면·조작 관찰은 사용자가 제공한 별도 근거다.

| 도구             | 참고 사례·자료                                                                                                                                                                                                                                                                | 적용한 판단                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 희석             | [Thermo Fisher DailyCalcs](https://www.thermofisher.com/ch/en/home/life-science/lab-data-management-analysis-software/lab-apps/dailycalcs-science-calculator-app.html)                                                                                                        | 농도·최종 부피에서 원액/희석액을 바로 계산하고, 호환되는 농도 단위만 선택한다. 연속 희석은 별도 표로 확인한다.                                                         |
| 몰농도           | [DailyCalcs](https://www.thermofisher.com/ch/en/home/life-science/lab-data-management-analysis-software/lab-apps/dailycalcs-science-calculator-app.html)                                                                                                                      | 구할 값을 먼저 고르고 해당 결과와 입력을 구분한다. 시약 검색의 분자량을 사용할 수 있다.                                                                                |
| 마스터 믹스      | [NEB PCR reaction setup](https://www.neb.com/protocols/pcr-using-q5-high-fidelity-dna-polymerase-m0491)                                                                                                                                                                       | 반응당 조성과 전체량을 구분한다. 반응 수·여유량을 바꾸면 총량을 갱신한다. 모바일 성분 입력은 세로로 배치한다. 제조사 조성을 기본값으로 복제하지 않는다.                |
| 배지/버퍼        | [LabArchives widgets](https://help.labarchives.com/hc/en-us/articles/11732040270484-Introduction-to-Widgets)                                                                                                                                                                  | 기준 제조량과 목표 제조량을 나누고 사용자 레시피를 환산한다. 제조 완료 상태는 누르기 쉬운 체크 버튼으로 표시한다.                                                      |
| 플레이트 라벨링  | [Benchling plate maps](https://help.benchling.com/hc/en-us/articles/39943809066637-Create-and-track-samples-with-the-Inventory)                                                                                                                                               | well 선택 → 공통 시료/조건/반복/색상 적용 → 전체 배치 검토. 자동 초안으로 이동 시 입력을 보존한다. 재고 기능까지 확장하지 않는다.                                      |
| 젤/블롯          | [ImageJ annotation](https://imagej.net/imaging/annotating-images), [gels](https://imagej.net/ij/docs/menus/analyze.html)                                                                                                                                                      | 원본에 주석을 겹쳐 편집하고 별도 출력한다. lane/band/ladder를 수동으로 표시하며 정량·자동 검출은 제공하지 않는다.                                                      |
| 이미지 측정      | [ImageJ spatial calibration](https://imagej.net/imaging/spatial-calibration)                                                                                                                                                                                                  | 기준선 보정 → 도형 선택 → 측정 목록. 원본 좌표로 계산하며 표시 확대·회전은 결과를 바꾸지 않는다. 다른 이미지에 복사한 설정은 재보정한다.                               |
| 세포 배양        | [Gibco handbook](https://documents.thermofisher.com/TFS-Assets/BID/Handbooks/gibco-cell-culture-basics-handbook.pdf)                                                                                                                                                          | 세포주별 입력과 분주 실행을 구분하고 용기별 원액·배지량을 보여준다. 모델 예측과 실측을 구분한다.                                                                       |
| 세포 계수        | [Thermo Fisher hemocytometer](https://www.thermofisher.com/sg/en/home/references/gibco-cell-culture-basics/cell-culture-protocols/counting-cells-in-a-hemacytometer.html)                                                                                                     | 생존/사멸 계수, 희석배수, 계수 부피를 명시하고 농도·생존율을 계산한다. 장비별 구획 부피 확인 안내를 둔다.                                                              |
| 타이머           | [Motorola Clock](https://help.motorola.com/hc/8020/11/global/en-us/CGjcb0611131435.html)                                                                                                                                                                                      | 시·분·초와 빠른 시간 선택, 이름별 여러 타이머, 시작/정지/재개/초기화를 분리한다. 종료 절대시각으로 복원한다.                                                           |
| 스톱워치         | [Apple Clock](https://support.apple.com/en-lamr/guide/clock-mac/apdwf3f9543b/mac)                                                                                                                                                                                             | 도구를 열면 바로 시작할 수 있다. 경과시간을 크게 표시하고 정지/재개·초기화를 구분한다. 랩(구간·누적)을 기록하고 복사·CSV로 내보낸다.                                              |
| 알람             | [Google Clock alarms](https://support.google.com/clock/answer/2840926?hl=en)                                                                                                                                                                                                  | 날짜·시각, 누르기 쉬운 반복 요일, 활성 상태, 다음 발생 시각을 구분한다. 계정 정의와 기기별 알림 권한을 분리한다.                                                       |
| 카운터           | [Tally Count](https://tallycount.app/), 사용자 Lab Laps 스크린샷                                                                                                                                                                                                              | 큰 영역으로 +1, 독립적인 −1, 단일/다중 카운터, 전체·항목 비율, 실행 취소, 집중 모드. 값을 자동 보존하며 초기화는 확인 후 실행한다.                                     |
| 계산기           | [Windows Calculator](https://support.microsoft.com/en-gb/windows/apps/use-the-calculator-in-windows)                                                                                                                                                                          | 일반 숫자 키패드·큰 결과·과학 함수·RAD/DEG·재사용 가능한 계산 내역. 수식 프로젝트 작성 절차를 요구하지 않는다.                                                         |
| 단위 변환        | [Windows converters](https://support.microsoft.com/en-gb/windows/apps/use-the-calculator-in-windows), [Thermo Fisher centrifuge](https://www.thermofisher.com/us/en/home/life-science/lab-equipment/lab-equipment-learning-center/centrifuges/centrifuge-best-practices.html) | 변환 종류별 단위를 제한하고 값/단위 교환과 결과 복사를 제공한다. MW·용액 밀도는 필요한 경우만 묻는다. RPM/RCF에는 로터 반지름을 직접 입력한다.                         |
| 사용자 지정 수식 | [Desmos variable sliders](https://help.desmos.com/hc/en-us/articles/202529069-Sliders-and-Movable-Points-in-a-Graph), 사용자 앱 조작                                                                                                                                          | 수식에서 변수를 추출하고 즉시 재계산한다. 잠금·증감·미입력 상태를 구분한다. 문서는 선택적으로 이름을 붙여 재사용한다.                                                  |
| 검량선           | [GraphPad interpolation](https://graphpad.com/guides/prism/latest/curve-fitting/reg_interpolating_with_linear_or_n.htm)                                                                                                                                                       | 표준과 미지 시료, 모델과 표시 축, 정방향과 역산을 구분한다. 오류 행·외삽·역산 불가를 표시한다. 헤더는 명시적으로 선택하고 조용히 행을 제외하지 않는다.                 |
| 노트             | [OneNote navigation](https://support.microsoft.com/en-gb/onenote/onenote-help-and-learning/navigate-your-notes-with-onenote)                                                                                                                                                  | 검색 가능한 메모 목록과 본문 편집, 태그·작업 링크·휴지통 복원. 별도의 문서 생성 화면은 두지 않는다.                                                                    |
| 캘린더           | [Google Calendar import](https://support.google.com/calendar/answer/37118), [recurrence](https://support.google.com/calendar/answer/37115)                                                                                                                                    | 월/주/목록, 일정별 반복·종료·예외와 ICS를 제공한다. 지원하지 않는 반복 규칙을 임의 변환하지 않는다.                                                                    |
| 아미노산         | [PubChem](https://pubchem.ncbi.nlm.nih.gov/), [ExPASy reference context](https://web.expasy.org/protparam/protparam-doc.html)                                                                                                                                                 | 이름/약어 검색과 곁사슬 분류, 2D 구조·분자식·유리 분자량. 펩타이드 잔기 질량과 pH별 전하를 혼동하지 않도록 기준을 표시한다.                                            |
| 코돈             | [NCBI genetic codes](https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi#SG1)                                                                                                                                                                                            | RNA/DNA, 휠/표, 5′→3′ 순서, 코돈/아미노산 검색, 시작/종결 표시. 큰 휠을 확대하거나 문자 검색으로 조회할 수 있다. 표 1로 범위를 명시한다.                               |
| 래더             | [NEB ladders](https://www.neb.com/en/products/markers-and-ladders/dna-markers-and-ladders)                                                                                                                                                                                    | DNA/RNA/단백질, 제조사·제품번호·공식 링크, 밴드 크기·강조·도식. 제품마다 다른 밴드 자료를 추정해서 배포하지 않는다. 로그 도식이 실제 이동 거리 예측이 아님을 표시한다. |
| 주기율표         | [PubChem element pages](https://pubchem.ncbi.nlm.nih.gov/docs/periodic-table-element-pages)                                                                                                                                                                                   | 118개 원소의 위치·분류 색상, 원자번호 정확 검색, 확대, 원소별 물성 및 이전/다음 이동. 기본 표에서 읽기 어려운 정보는 상세에서 제공한다.                                |

## 2026-11-27 개선 내용

위 표는 2026-11-09 첫 구현의 판단 기록이다. 아래는 그 뒤 전수 조사로 고치고 더한 것이다. 계획과 결정은 프로젝트 메모리(`lab-tools-improvement-plan`)에, 시각화 대상 선정은 `docs/strategy/lab-tools-visualization-review-2026-11.md`에 있다.

**공통**
- 저장: 첫 내려받기 전 거짓 충돌, 로그아웃 시 미동기화 작업 유실, 오프라인에서의 "저장 중" 표시를 고쳤다. 쓰기는 묶어서 기록하고 전송한다. 도구 주소로 바로 들어올 때 빈 초안이 새로 생기던 문제를 고쳤다(도구당 초안 하나).
- 탐색: 즐겨찾기 고정, 최근 사용, 동의어 검색, 아이콘. 저장한 작업 목록에서 이름 변경·복제·휴지통·영구 삭제.
- 도구 간 전달(`handoff.ts`): 몰농도 → 희석, 플레이트 → 마스터 믹스·검량선, 세포 계수 → 세포 배양, 주기율표(화학식) → 몰농도. 값은 복사되는 스냅숏이다.
- 시약 분자량 선택기(`ReagentLookup`)를 희석·몰농도·배지/버퍼·단위 변환이 함께 쓴다. 연구실 재고는 읽지 않는다.
- 그림(`charts.tsx`): 분할 막대, 미터, 막대 목록, 선·점 그림, 농담 눈금, 옮김 도식. 색은 앱의 밝은·어두운 배경에서 색각 이상 구분을 검증한 고정 순서만 쓰고, 모든 그림에 값 라벨과 표가 딸린다.

**계산 도구**
- 희석: 구할 값 선택, 1 : N·X 배수, 몰농도↔질량농도, 제조 문장 복사, 연속 희석표(옮길 양·남는 양·합계)와 옮김 도식, 0.5 µL 미만 분주 경고와 중간 희석 제안.
- 몰농도: 순도, kDa, 제조 문장, "이 용액을 희석". 단위를 바꿔도 친 숫자는 그대로 둔다.
- 마스터 믹스·배지/버퍼: 원액→최종 농도 입력, 반응 부피까지 물로 채움, 반응별 개별 첨가, 제조 단계와 진행 표시, 구성 막대.
- 단위 변환(단위 추가, 필요한 입력 안내), 계산기(ANS, 암시적 곱, `50 + 10 %` = 55), 사용자 수식(변수별 증감 단위·설명, 변수에 따른 결과 그림).

**시간 도구와 알림**
- 타이머(프리셋 편집, 초과 시간, 실행 취소, 진행 미터), 스톱워치(랩), 알람(다시 알림, 정렬, 지난 알람 정리), 카운터(항목 추가·삭제, 증감 단위, 직접 입력, 진동).
- 알림은 순수 모듈(`notificationPlan.ts`)이 계획하고 입력이 바뀔 때만 다시 계산한다. 웹은 소리·브라우저 알림·여러 건 쌓기·놓친 알림·탭 중복 방지, 네이티브는 본문·누르면 이동·채널·차이만 재예약. iOS 64건 한도는 유효기한 알림과 나눠 쓴다(`reminders/deviceNotifications.ts`).

**새 도구** (서버 `tool_id` 확장 migration `20261127090000_lab_tools_usage_and_purge.sql` 적용 전까지는 기기에만 보관한다)
- 프라이머 · 올리고: nearest-neighbour Tm(SantaLucia 1998), GC%, 분자량, 재현탁 부피.
- 핵산 정량: A260 → 농도·순도, 질량 ↔ 몰수·복제 수, 라이게이션 몰비.

## 검증과 공개 조건

브라우저 점검에서는 23개 도구의 기본 화면을 모바일 390px, 태블릿 768px에서 각각 열고 페이지 전체의 가로 넘침과 표시 오류가 없음을 확인했다. 별도로 한국어/영어, 다크 모드, 일반 탭 복귀, 단위 변환, 다중 계수와 집중 모드, 이미지 치수 편집·회전·반전, PNG/PDF 파일을 확인했다. 사각형 10×2 mm의 20 mm²가 회전·반전 후 유지되었다. PDF는 페이지를 렌더링해 확인했다. 이 검증은 운영 서버 동기화나 네이티브 실기기 검증을 대신하지 않는다.

- 계산 엔진은 UI와 분리하고 독립 기준값으로 검증한다. `engines.test.ts`, `interactions.test.tsx`, `screens.test.tsx` 참조.
- 저장·충돌·RLS는 `repository.test.ts`, `database.test.ts`에서 검증한다. 개발 서버의 로컬 저장 성공을 서버 동기화 성공으로 표시하지 않는다.
- 한국어/영어와 모바일·태블릿·데스크톱에서 같은 사용자 흐름을 제공한다. 기기별 네이티브 알림 코드는 연결하되 실기기 테스트는 사용자 요청에 따라 별도 수행하지 않는다.
- SQL은 `supabase/migrations/20261109011725_personal_lab_tools.sql`과 `20261109011747_tool_images_account_deletion.sql`로 관리한다. Staging·운영에 적용 후 소유권·저장 충돌·이미지 접근 pgTAP 30개를 각 환경에서 통과했다. 기존 해시 고정 검증과 Quality·Staging 공개 절차를 유지하며, `VITE_ENABLE_LAB_TOOLS`를 두 환경에서 명시적으로 활성화한다.
- 오프라인 초안은 문서 생성 없이 사용할 수 있도록 숨겨진 저장 상태로 관리한다. 개인 재사용 작업만 이름을 붙여 계정에 저장하며, 참조 자료는 문서를 만들지 않는다.

## 구현 규칙 (2026-11-27 공통 기반 정리 이후)

도구를 고치거나 추가할 때 따르는 규칙이다. 근거는 각 모듈의 주석에 있다.

**구조**
- 도구 하나에 파일 하나(`DilutionTool.tsx` 등, default export). 계산은 UI와 분리한 순수 모듈(`labMath.ts`, `molarity.ts`, `calibration.ts` 등)에 두고 독립 기준값으로 테스트한다.
- 도구 메타(종류·이름·설명·검색 키워드)는 `registry.ts`, 아이콘은 `toolIcons.ts`, 화면 연결은 `ToolScreen.tsx`, 사용 방법은 `ToolGuide.tsx`. 도구 id는 서버 `tool_id` CHECK와 같아야 하며(`engines.test.ts`가 검사) 새 id는 migration이 먼저다.
- 종류(`kind`): `reference`(문서 없음) / `workspace`(계정당 고정 id 문서 하나, 자동 동기화) / `project`(기기 초안 → "작업 저장"으로 이름 붙은 문서).

**상태와 저장**
- 문서 상태는 `useToolData(defaults)`로 읽고 쓴다. 화면은 즉시 바뀌고 기기 기록·서버 전송은 저장소가 묶어서 처리하므로 도구가 따로 지연시키지 않는다.
- 저장 데이터는 하위 호환으로만 바꾼다(서버 `schema_version`은 1 고정이고 이미 배포된 앱이 같은 데이터를 읽는다). 필드를 추가하고, 옛 필드는 계속 읽는다. 숫자로 저장하던 필드는 문자열로 바꾸지 않고 빈 값만 `null`로 둔다.

**숫자**
- 새 입력은 `NumberField`(문자열 보관) 또는 `QuantityField`(값+단위). 이미 숫자로 저장하는 필드는 `StoredNumberField`(숫자 | null).
- 계산은 `calculate(() => …)` 안에서 `need(값)`으로 읽는다. 빈칸은 오류가 아니라 `incomplete`이며, 화면은 오류 대신 무엇을 입력하면 되는지 안내한다.
- 표시는 `format()`(유효숫자 7자리, 앱 언어 기준). 복사·CSV·입력란에 넣는 값은 `plainNumber()`. `csv()`는 숫자 셀을 알아서 정리한다.

**공용 UI (`ui.tsx`)**
- 복사: `CopyButton`(성공·실패 표시 포함). `navigator.clipboard`를 직접 부르지 않는다.
- 삭제: 확인 대화상자 없이 바로 지우고 `useUndo()`로 되돌리기를 제공한다. 되돌릴 수 없는 동작만 `.tool-inline-confirm`으로 확인한다.
- 빈 상태: `EmptyState`. 내보내기 파일명: `useExportName()`(`buril-<도구>-<제목>-YYYYMMDD-HHmm`). 고정 파일명은 휴대폰에서 이전 파일을 덮어쓴다.
- 오류: 엔진은 영어 문구로 `Error`를 던지고 `ErrorMessage`가 번역한다. 새 문구는 `ui.tsx`의 `errorTranslations`에 추가한다.
- 문자열은 `const t = useText()`의 `t(한국어, 영어)`. `screens.test.tsx`가 영어 화면에 한글이 남지 않는지 검사한다.

**도구 간 연결**
- 값 보내기: `ctx.sendTo?.(도구 id, { kind, value, unit, label, source })`. 받는 도구는 `<HandoffBanner accepts={[…]} onApply={…} />`를 값이 들어갈 자리에 둔다. 값은 복사되는 스냅숏이고 링크가 아니다(`handoff.ts`).
- 분자량: `<ReagentLookup onApply={…} />`. 시약 검색만 사용하고 연구실 재고는 읽지 않는다. 최근 시약은 계정 환경설정에 있어 도구끼리 공유된다.
- 타이머: `startTimer(repo, { name, durationMs })`(`timers.ts`).

**확인**
- `npx vitest run src/features/tools`, `npx tsc -b`, `npx eslint src/features/tools`.
- 화면: 미리보기 `adaptive-fixture`에서 `…/e2e/adaptive/fixture.html?screen=tools&path=/app/tools/<도구 id>`. 로그인 없이 뜨며 서버 동기화는 일어나지 않는다.
