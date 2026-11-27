export const elementNamesKo =
  "수소 헬륨 리튬 베릴륨 붕소 탄소 질소 산소 플루오린 네온 나트륨 마그네슘 알루미늄 규소 인 황 염소 아르곤 칼륨 칼슘 스칸듐 타이타늄 바나듐 크로뮴 망가니즈 철 코발트 니켈 구리 아연 갈륨 저마늄 비소 셀레늄 브로민 크립톤 루비듐 스트론튬 이트륨 지르코늄 나이오븀 몰리브데넘 테크네튬 루테늄 로듐 팔라듐 은 카드뮴 인듐 주석 안티모니 텔루륨 아이오딘 제논 세슘 바륨 란타넘 세륨 프라세오디뮴 네오디뮴 프로메튬 사마륨 유로퓸 가돌리늄 터븀 디스프로슘 홀뮴 어븀 툴륨 이터븀 루테튬 하프늄 탄탈럼 텅스텐 레늄 오스뮴 이리듐 백금 금 수은 탈륨 납 비스무트 폴로늄 아스타틴 라돈 프랑슘 라듐 악티늄 토륨 프로트악티늄 우라늄 넵투늄 플루토늄 아메리슘 퀴륨 버클륨 캘리포늄 아인슈타이늄 페르뮴 멘델레븀 노벨륨 로렌슘 러더포듐 더브늄 시보귬 보륨 하슘 마이트너륨 다름슈타튬 뢴트게늄 코페르니슘 니호늄 플레로븀 모스코븀 리버모륨 테네신 오가네손".split(
    " "
  );
/**
 * Where an element sits in the 18-column table: [column, row]. Rows 1–7 are
 * the periods; the lanthanides and actinides are set apart in rows 9 and 10,
 * under columns 3–17.
 */
export function elementPosition(n: number): [column: number, row: number] {
  if (n === 1) return [1, 1];
  if (n === 2) return [18, 1];
  if (n <= 10) return [n < 5 ? n - 2 : n + 8, 2];
  if (n <= 18) return [n < 13 ? n - 10 : n, 3];
  if (n <= 36) return [n - 18, 4];
  if (n <= 54) return [n - 36, 5];
  if (n <= 56) return [n - 54, 6];
  if (n <= 71) return [n - 54, 9];
  if (n <= 86) return [n - 68, 6];
  if (n <= 88) return [n - 86, 7];
  if (n <= 103) return [n - 86, 10];
  return [n - 100, 7];
}
/** Period (1–7). The rows set apart below the table belong to periods 6 and 7. */
export function elementPeriod(n: number) {
  const row = elementPosition(n)[1];
  return row > 7 ? row - 3 : row;
}
/**
 * Group (1–18), or null for the lanthanides and actinides: the 18-column table
 * gives the 15 elements of each of those rows no group number.
 */
export function elementGroup(n: number) {
  const [column, row] = elementPosition(n);
  return row > 7 ? null : column;
}
export type ElementStep =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End";
/**
 * The element a key moves to from element `n` on the table as drawn. Empty
 * cells are skipped: right of H is He, and below Y is La. Home and End go to
 * the ends of the row. Returns `n` when there is nothing that way.
 */
export function stepElement(n: number, key: ElementStep, count = 118) {
  const [column, row] = elementPosition(n),
    vertical = key === "ArrowUp" || key === "ArrowDown";
  // The elements on the line of travel (the column for up and down, the row
  // otherwise), in order along it.
  const line: [place: number, element: number][] = [];
  for (let other = 1; other <= count; other++) {
    const [c, r] = elementPosition(other);
    if (vertical ? c === column : r === row)
      line.push([vertical ? r : c, other]);
  }
  line.sort((a, b) => a[0] - b[0]);
  const here = line.findIndex(([, element]) => element === n);
  const target =
    key === "Home"
      ? 0
      : key === "End"
      ? line.length - 1
      : here + (key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1);
  return line[target]?.[1] ?? n;
}
/** Units of the PubChem columns, for labels that are built from column names. */
export const elementUnits: Record<string, string> = {
  AtomicRadius: "pm",
  IonizationEnergy: "eV",
  ElectronAffinity: "eV",
  MeltingPoint: "K",
  BoilingPoint: "K",
  Density: "g/cm³",
};
/** PubChem columns that are magnitudes and so can shade the table. */
export const elementScales = [
  "AtomicMass",
  "Electronegativity",
  "AtomicRadius",
  "IonizationEnergy",
  "ElectronAffinity",
  "MeltingPoint",
  "BoilingPoint",
  "Density",
] as const;
export const elementLabels: Record<string, string> = {
  AtomicNumber: "원자번호",
  Symbol: "기호",
  Name: "이름",
  AtomicMass: "원자량",
  CPKHexColor: "CPK 색상",
  ElectronConfiguration: "전자 배치",
  Electronegativity: "전기음성도",
  AtomicRadius: "원자 반지름 (pm)",
  IonizationEnergy: "이온화 에너지 (eV)",
  ElectronAffinity: "전자 친화도 (eV)",
  OxidationStates: "산화수",
  StandardState: "표준 상태",
  MeltingPoint: "녹는점 (K)",
  BoilingPoint: "끓는점 (K)",
  Density: "밀도 (g/cm³)",
  GroupBlock: "원소 분류",
  YearDiscovered: "발견 연도",
};
