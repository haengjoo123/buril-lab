export type ToolCategory = "Lab" | "General" | "Library";
/**
 * How a tool keeps its state, which decides what the shell offers around it.
 * - reference: read-only material; no document.
 * - workspace: one document per account with a fixed id, synced as it changes
 *   (timers, alarms, counters, notes, calendar).
 * - project: opens on a device-only draft that can be saved as named work.
 * - quick: a device-only draft of scratch inputs; nothing to save.
 */
export type ToolKind = "reference" | "workspace" | "project" | "quick";
interface ToolMeta {
  id: string;
  category: ToolCategory;
  kind: ToolKind;
  ko: string;
  en: string;
  descKo: string;
  descEn: string;
  /** Other words people search by, in either language. */
  keywords: readonly string[];
}
// A tool whose documents reach the server (workspace, project) must have its id
// in the server's `tool_id` CHECK constraint, so a new synced id needs a
// migration first. `engines.test.ts` checks this against the migration files.
export const tools = [
  {
    id: "dilution",
    category: "Lab",
    kind: "project",
    ko: "희석",
    en: "Dilution",
    descKo: "농도와 연속 희석",
    descEn: "Concentration and serial dilution",
    keywords: ["C1V1", "M1V1", "희석배수", "배수", "원액", "stock", "serial"],
  },
  {
    id: "molarity",
    category: "Lab",
    kind: "project",
    ko: "몰농도",
    en: "Molarity",
    descKo: "질량 · 분자량 · 부피",
    descEn: "Mass, molecular weight and volume",
    keywords: ["몰", "mol", "MW", "g/mol", "용액 제조", "농도 계산", "solution"],
  },
  {
    id: "master-mix",
    category: "Lab",
    kind: "project",
    ko: "마스터 믹스",
    en: "Master Mix",
    descKo: "반응 조성과 분주표",
    descEn: "Reaction recipes and dispensing",
    keywords: ["PCR", "qPCR", "반응", "reaction", "프리믹스", "premix", "mix"],
  },
  {
    id: "medium-buffer",
    category: "Lab",
    kind: "project",
    ko: "배지 / 버퍼",
    en: "Medium / Buffer",
    descKo: "레시피와 제조 체크리스트",
    descEn: "Recipes and preparation checklist",
    keywords: ["레시피", "recipe", "PBS", "TAE", "TBS", "제조", "스케일", "scale"],
  },
  {
    id: "plate-labelling",
    category: "Lab",
    kind: "project",
    ko: "플레이트 라벨링",
    en: "Plate Labelling",
    descKo: "시료와 실험 조건 배치",
    descEn: "Samples and conditions",
    keywords: ["96", "384", "웰", "well", "플레이트 맵", "plate map", "배치"],
  },
  {
    id: "gel-blot",
    category: "Lab",
    kind: "project",
    ko: "젤 / 블롯",
    en: "Gel / Blot",
    descKo: "Lane, band, ladder 주석",
    descEn: "Lane, band and ladder annotation",
    keywords: ["전기영동", "웨스턴", "western", "밴드", "레인", "electrophoresis"],
  },
  {
    id: "image-measurer",
    category: "Lab",
    kind: "project",
    ko: "이미지 측정",
    en: "Image Measurer",
    descKo: "스케일과 길이 · 면적",
    descEn: "Calibrated length and area",
    keywords: ["길이", "면적", "스케일 바", "scale bar", "현미경", "microscope"],
  },
  {
    id: "cell-culture",
    category: "Lab",
    kind: "project",
    ko: "세포 배양",
    en: "Cell Culture",
    descKo: "분주 · 성장 예측 · 계대 기록",
    descEn: "Seeding, growth and passages",
    keywords: ["계대", "passage", "seeding", "confluence", "배가", "doubling", "split"],
  },
  {
    id: "cell-counter",
    category: "Lab",
    kind: "project",
    ko: "세포 계수",
    en: "Cell Counter",
    descKo: "수동 계수와 생존율",
    descEn: "Manual counts and viability",
    keywords: ["혈구계", "혈구계산판", "hemocytometer", "Neubauer", "트리판", "trypan", "생존율", "viability"],
  },
  // The two tools below are newer than the server's first list of tool ids.
  // They are `quick` (device-only, nothing sent) until the migration that adds
  // their ids has been applied; then they can become `project`.
  {
    id: "primer",
    category: "Lab",
    kind: "quick",
    ko: "프라이머 · 올리고",
    en: "Primer / Oligo",
    descKo: "Tm · GC · 분자량 · 원액",
    descEn: "Tm, GC, molecular weight and stocks",
    keywords: ["Tm", "annealing", "올리고", "oligo", "PCR", "역상보", "reverse complement", "재현탁", "resuspend"],
  },
  {
    id: "nucleic-acid",
    category: "Lab",
    kind: "quick",
    ko: "핵산 정량",
    en: "Nucleic Acid",
    descKo: "A260 농도 · 몰 환산 · 라이게이션",
    descEn: "A260, moles and ligation",
    keywords: ["A260", "A280", "NanoDrop", "나노드롭", "pmol", "카피 수", "copy number", "ligation", "라이게이션", "DNA", "RNA"],
  },
  {
    id: "timer",
    category: "General",
    kind: "workspace",
    ko: "타이머",
    en: "Timer",
    descKo: "이름별 다중 카운트다운",
    descEn: "Named countdowns",
    keywords: ["카운트다운", "countdown", "인큐베이션", "incubation", "알림"],
  },
  {
    id: "stopwatch",
    category: "General",
    kind: "workspace",
    ko: "스톱워치",
    en: "Stopwatch",
    descKo: "경과시간 측정",
    descEn: "Elapsed time",
    keywords: ["경과", "elapsed", "랩", "lap"],
  },
  {
    id: "alarm",
    category: "General",
    kind: "workspace",
    ko: "알람",
    en: "Alarm",
    descKo: "기기별 예약 알림",
    descEn: "Device notifications",
    keywords: ["알림", "예약", "reminder", "반복"],
  },
  {
    id: "counter",
    category: "General",
    kind: "workspace",
    ko: "카운터",
    en: "Counter",
    descKo: "이름별 수량 기록",
    descEn: "Named counters",
    keywords: ["계수", "세기", "tally", "클리커", "clicker", "콜로니", "colony"],
  },
  {
    id: "calculator",
    category: "General",
    kind: "workspace",
    ko: "계산기",
    en: "Calculator",
    descKo: "기본 과학 계산",
    descEn: "Scientific calculations",
    keywords: ["계산", "과학", "sin", "log", "sqrt", "제곱근"],
  },
  {
    id: "unit-converter",
    category: "General",
    kind: "workspace",
    ko: "단위 변환",
    en: "Unit Converter",
    descKo: "질량 · 부피 · 농도 외",
    descEn: "Mass, volume, concentration and more",
    keywords: ["RCF", "RPM", "원심", "원심분리", "centrifuge", "ppm", "온도", "섭씨", "환산", "convert"],
  },
  {
    id: "custom-equation",
    category: "General",
    kind: "project",
    ko: "사용자 지정 수식",
    en: "Custom Equation",
    descKo: "변수를 가진 재사용 수식",
    descEn: "Reusable equations with variables",
    keywords: ["수식", "공식", "formula", "변수", "variable"],
  },
  {
    id: "calibration-curve",
    category: "General",
    kind: "project",
    ko: "검량선",
    en: "Calibration Curve",
    descKo: "선형 · 지수 · Hill",
    descEn: "Linear, exponential and Hill",
    keywords: ["표준곡선", "검정곡선", "standard curve", "회귀", "regression", "BCA", "Bradford", "ELISA"],
  },
  {
    id: "notes",
    category: "General",
    kind: "workspace",
    ko: "노트",
    en: "Notes",
    descKo: "실험 메모와 문서 연결",
    descEn: "Notes and document links",
    keywords: ["메모", "memo", "기록", "태그", "tag"],
  },
  {
    id: "calendar",
    category: "General",
    kind: "workspace",
    ko: "캘린더",
    en: "Calendar",
    descKo: "반복 일정과 ICS",
    descEn: "Recurring events and ICS",
    keywords: ["일정", "schedule", "예약", "달력"],
  },
  {
    id: "amino-acids",
    category: "Library",
    kind: "reference",
    ko: "아미노산",
    en: "Amino Acids",
    descKo: "표준 아미노산 참고 자료",
    descEn: "Standard amino acids",
    keywords: ["pKa", "pI", "잔기", "residue", "단백질", "protein"],
  },
  {
    id: "codons",
    category: "Library",
    kind: "reference",
    ko: "코돈",
    en: "Codon Wheel / Table",
    descKo: "표준 유전암호",
    descEn: "Standard genetic code",
    keywords: ["유전암호", "genetic code", "번역", "translation", "DNA", "RNA", "서열"],
  },
  {
    id: "ladders",
    category: "Library",
    kind: "project",
    ko: "래더",
    en: "Ladders",
    descKo: "사용자 정의 band 자료",
    descEn: "Custom band references",
    keywords: ["마커", "marker", "size standard", "bp", "kDa", "밴드"],
  },
  {
    id: "periodic-table",
    category: "Library",
    kind: "reference",
    ko: "주기율표",
    en: "Periodic Table",
    descKo: "원소 검색과 기본 정보",
    descEn: "Elements and properties",
    keywords: ["원소", "element", "원자량", "atomic mass", "화학식"],
  },
] as const satisfies readonly ToolMeta[];
export type ToolId = (typeof tools)[number]["id"];
export type Tool = (typeof tools)[number];
export const isToolId = (s: string): s is ToolId =>
  tools.some((tool) => tool.id === s);
export const toolById = (id: string): Tool | undefined =>
  tools.find((tool) => tool.id === id);
export const toolKind = (id: string): ToolKind | undefined => toolById(id)?.kind;
/**
 * Tools whose quick-use draft can be kept as named work ("작업 저장"). Their
 * drafts are work in progress; a quick tool's draft is scratch input.
 */
export const projectToolIds: readonly ToolId[] = tools
  .filter((tool) => tool.kind === "project")
  .map((tool) => tool.id);
export const ENGINE_VERSION = "1.0.0";
export type SaveStatus =
  | "loading"
  | "saving"
  | "local"
  | "synced"
  | "conflict"
  | "error";
export interface ToolDocument {
  id: string;
  owner_id: string;
  tool_id: ToolId;
  title: string;
  data: Record<string, unknown>;
  schema_version: number;
  engine_version: string;
  revision: number;
  updated_at: string;
  deleted_at?: string | null;
}
