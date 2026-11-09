export const tools = [
  [
    "dilution",
    "Lab",
    "희석",
    "Dilution",
    "농도와 연속 희석",
    "Concentration and serial dilution",
  ],
  [
    "molarity",
    "Lab",
    "몰농도",
    "Molarity",
    "질량 · 분자량 · 부피",
    "Mass, molecular weight and volume",
  ],
  [
    "master-mix",
    "Lab",
    "마스터 믹스",
    "Master Mix",
    "반응 조성과 분주표",
    "Reaction recipes and dispensing",
  ],
  [
    "medium-buffer",
    "Lab",
    "배지 / 버퍼",
    "Medium / Buffer",
    "레시피와 제조 체크리스트",
    "Recipes and preparation checklist",
  ],
  [
    "plate-labelling",
    "Lab",
    "플레이트 라벨링",
    "Plate Labelling",
    "시료와 실험 조건 배치",
    "Samples and conditions",
  ],
  [
    "gel-blot",
    "Lab",
    "젤 / 블롯",
    "Gel / Blot",
    "Lane, band, ladder 주석",
    "Lane, band and ladder annotation",
  ],
  [
    "image-measurer",
    "Lab",
    "이미지 측정",
    "Image Measurer",
    "스케일과 길이 · 면적",
    "Calibrated length and area",
  ],
  [
    "cell-culture",
    "Lab",
    "세포 배양",
    "Cell Culture",
    "분주 · 성장 예측 · 계대 기록",
    "Seeding, growth and passages",
  ],
  [
    "cell-counter",
    "Lab",
    "세포 계수",
    "Cell Counter",
    "수동 계수와 생존율",
    "Manual counts and viability",
  ],
  [
    "timer",
    "General",
    "타이머",
    "Timer",
    "이름별 다중 카운트다운",
    "Named countdowns",
  ],
  [
    "stopwatch",
    "General",
    "스톱워치",
    "Stopwatch",
    "경과시간 측정",
    "Elapsed time",
  ],
  [
    "alarm",
    "General",
    "알람",
    "Alarm",
    "기기별 예약 알림",
    "Device notifications",
  ],
  [
    "counter",
    "General",
    "카운터",
    "Counter",
    "이름별 수량 기록",
    "Named counters",
  ],
  [
    "calculator",
    "General",
    "계산기",
    "Calculator",
    "기본 과학 계산",
    "Scientific calculations",
  ],
  [
    "unit-converter",
    "General",
    "단위 변환",
    "Unit Converter",
    "질량 · 부피 · 농도 외",
    "Mass, volume, concentration and more",
  ],
  [
    "custom-equation",
    "General",
    "사용자 지정 수식",
    "Custom Equation",
    "변수를 가진 재사용 수식",
    "Reusable equations with variables",
  ],
  [
    "calibration-curve",
    "General",
    "검량선",
    "Calibration Curve",
    "선형 · 지수 · Hill",
    "Linear, exponential and Hill",
  ],
  [
    "notes",
    "General",
    "노트",
    "Notes",
    "실험 메모와 문서 연결",
    "Notes and document links",
  ],
  [
    "calendar",
    "General",
    "캘린더",
    "Calendar",
    "반복 일정과 ICS",
    "Recurring events and ICS",
  ],
  [
    "amino-acids",
    "Library",
    "아미노산",
    "Amino Acids",
    "표준 아미노산 참고 자료",
    "Standard amino acids",
  ],
  [
    "codons",
    "Library",
    "코돈",
    "Codon Wheel / Table",
    "표준 유전암호",
    "Standard genetic code",
  ],
  [
    "ladders",
    "Library",
    "래더",
    "Ladders",
    "사용자 정의 band 자료",
    "Custom band references",
  ],
  [
    "periodic-table",
    "Library",
    "주기율표",
    "Periodic Table",
    "원소 검색과 기본 정보",
    "Elements and properties",
  ],
] as const;
export type ToolId = (typeof tools)[number][0];
export type ToolCategory = (typeof tools)[number][1];
export const isToolId = (s: string): s is ToolId =>
  tools.some((t) => t[0] === s);
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
