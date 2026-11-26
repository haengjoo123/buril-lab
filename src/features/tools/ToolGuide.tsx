import type { ToolId } from "./registry";
import { useText } from "./ui";
const guides: Partial<Record<ToolId, [string[], string[]]>> = {
  primer: [
    [
      "서열을 5′→3′ 방향으로 붙여 넣으세요. 공백·숫자는 무시하고 A, C, G, T만 계산합니다.",
      "Tm은 올리고 농도와 Na⁺ 농도에 따라 달라집니다. 사용하는 반응 조건에 맞춰 입력하세요.",
      "annealing 온도는 중합효소 제조사의 안내를 우선하세요. 이 값은 상보 가닥과 완전히 결합할 때의 계산값입니다.",
      "튜브 라벨의 nmol을 입력하면 원하는 원액 농도를 만드는 데 넣을 부피를 알려 줍니다.",
    ],
    [
      "Paste the sequence 5′→3′. Spaces and digits are ignored; only A, C, G and T are calculated.",
      "Tm depends on the oligo and Na⁺ concentrations. Enter the conditions of your reaction.",
      "Follow your polymerase vendor's guidance for annealing; this value assumes a perfect complement.",
      "Enter the nmol printed on the tube to get the volume that makes your stock concentration.",
    ],
  ],
  "nucleic-acid": [
    [
      "흡광도 → 농도: 핵산 종류를 고르고 A260, 희석배수, 광로 길이를 입력하세요. A280을 넣으면 A260/A280도 보여 줍니다.",
      "질량 ↔ 몰: 길이와 양(ng, µg 또는 pmol)을 입력하면 서로 환산하고 분자 수를 계산합니다.",
      "라이게이션: 벡터와 인서트의 길이, 벡터 양, 몰비를 입력하면 필요한 인서트 양을 계산합니다.",
      "분자량은 평균 염기 조성을 가정한 값입니다. 서열을 아는 올리고는 프라이머 · 올리고 도구가 더 정확합니다.",
    ],
    [
      "Absorbance → concentration: choose the nucleic acid and enter A260, dilution and path length. Add A280 to see A260/A280.",
      "Mass ↔ moles: enter the length and an amount (ng, µg or pmol) to convert and count molecules.",
      "Ligation: enter vector and insert lengths, vector mass and the molar ratio to get the insert mass.",
      "Weights assume average base composition. For an oligo of known sequence the Primer / Oligo tool is more exact.",
    ],
  ],
  "cell-culture": [
    [
      "세포주의 배양 방식과 doubling time을 설정하세요. 부착세포는 100% confluence에서의 밀도가 필요합니다.",
      "보유 세포 농도·부피를 입력하고 대상 용기를 추가하세요. 목표 방식은 농도, 용기당 세포수, 면적당 세포수, confluence 또는 split입니다.",
      "계대 기록은 바로 추가할 수 있습니다. 분주 계산에서 모든 용기를 완료하면 계산 결과도 함께 저장됩니다.",
      "성장 예측은 지수 성장 모델입니다. 타이머 시작 후 세포주 설정을 바꿔도 예약 시각은 유지됩니다.",
    ],
    [
      "Set culture type and doubling time. Adherent cultures also need density at 100% confluence.",
      "Enter stock concentration and volume, then add vessels. Choose concentration, cells per vessel, cells per area, confluence or split targets.",
      "Add passage records directly. Complete all vessel checks to include the seeding calculation.",
      "Growth is an exponential estimate. Starting a timer fixes its target time even if the profile changes.",
    ],
  ],
  "unit-converter": [
    [
      "변환 종류를 고르고 값과 단위를 입력하면 바로 변환됩니다. ‘다른 단위로’에서 같은 종류의 나머지 단위 값도 함께 볼 수 있습니다.",
      "몰농도와 질량 농도 사이는 분자량이, % w/w·ppm w/w와 다른 농도 사이는 용액 밀도가 필요합니다. 분자량은 시약 검색으로 가져올 수 있습니다.",
      "RPM ↔ RCF (× g)는 로터 반지름(cm)을 입력하세요. 회전축에서 시료까지의 거리이며 장비 설명서의 값을 사용합니다.",
      "교환은 결과를 새 입력값으로 옮기고 단위를 맞바꿉니다. 잠시 화면에 머문 변환은 최근 변환에 5개까지 남고, 누르면 다시 불러옵니다. 음수는 온도만 변환합니다.",
    ],
    [
      "Choose a conversion type, then enter a value and units; the result updates as you type. In other units shows the same value in the rest of that type's units.",
      "Molar ↔ mass concentration needs a molecular weight; % w/w or ppm w/w ↔ other concentrations needs the solution density. Reagent search can supply the molecular weight.",
      "For RPM ↔ RCF (× g), enter the rotor radius in cm: the distance from the rotation axis to the sample, as specified for your rotor.",
      "Swap moves the result into the input and exchanges the units. A conversion that stays on screen for a moment is kept under Recent conversions, up to five; tap one to restore it. Only temperatures may be negative.",
    ],
  ],
  calculator: [
    [
      "키패드나 키보드로 식을 입력하면 결과가 바로 표시됩니다. =(Enter)를 누르면 답이 다음 계산의 시작값이 되고 내역에 남습니다. AC(Esc)는 식을 지웁니다.",
      "ANS는 직전 답을 넣습니다. 2π, 2(3), 3sqrt(4)처럼 곱셈 기호는 생략할 수 있습니다.",
      "%는 일반 계산기처럼 동작합니다. 50+10%는 55, 50−10%는 45, 200×10%는 20, 25%는 0.25입니다.",
      "과학 함수의 sin·cos·tan은 RAD/DEG 설정을 따릅니다. log₁₀은 상용로그(식에는 log로 표시), ln은 자연로그, abs는 절댓값입니다.",
    ],
    [
      "Enter an expression with the keypad or a keyboard; the result shows as you type. = (Enter) keeps the answer as the start of the next calculation and adds it to the history. AC (Esc) clears the expression.",
      "ANS inserts the previous answer. The multiplication sign can be left out, as in 2π, 2(3) or 3sqrt(4).",
      "% works as on a pocket calculator: 50+10% is 55, 50−10% is 45, 200×10% is 20 and 25% is 0.25.",
      "Under Scientific, sin, cos and tan follow RAD/DEG. log₁₀ is the base-10 logarithm (written log in the expression), ln is the natural logarithm and abs is the absolute value.",
    ],
  ],
  "custom-equation": [
    [
      "a * b + c처럼 수식을 입력하면 변수 입력란이 생깁니다. 2, 3, 1을 입력하면 결과는 7입니다. 변수 이름에는 한글도 쓸 수 있고, 2x나 2(a+b)처럼 곱셈 기호는 생략할 수 있습니다.",
      "잠금은 상수처럼 유지할 값에 사용하세요. 초기화는 잠기지 않은 변수만 비웁니다. 0은 입력된 값으로 취급합니다. ‘설명·증감 단위’에서 변수 설명과 −/+ 버튼의 증감 단위를 정합니다.",
      "수학 키패드에는 수식에 있는 변수의 키도 나옵니다. sin/cos/tan은 RAD 또는 DEG 설정을 따릅니다. log10은 상용로그, ln은 자연로그이고 25%는 0.25입니다.",
      "소수 자릿수는 표시만 바꿉니다. 단위와 출처는 메모에 남기세요.",
    ],
    [
      "Enter a formula such as a * b + c to generate variable inputs. Values 2, 3 and 1 produce 7. Names may use letters of any script, and the multiplication sign can be left out, as in 2x or 2(a+b).",
      "Lock constants to keep them when resetting other inputs. Zero is a valid input; blank means missing. Under Label and step, describe a variable and set how much − and + change it.",
      "The math keypad also has a key for each variable in the equation. Trigonometry follows RAD/DEG. log10 is base 10; ln is natural log; 25% means 0.25.",
      "Rounding affects display only. Record units and sources in notes.",
    ],
  ],
  "calibration-curve": [
    [
      "표준값을 입력하고 그래프·시료 탭에서 결과를 확인하세요. 붙여넣기에서 첫 행이 제목이면 ‘첫 행은 열 이름’을 켜세요.",
      "선형·원점 고정·지수·증가형 Hill 중 선택하세요. Hill은 서로 다른 양수 X가 최소 5개 필요합니다.",
      "오류 행은 자동으로 제외되지 않습니다. 값을 수정하거나 해당 행의 ‘사용’을 꺼 적합에서 제외하세요.",
      "시료에서 Y → X는 역산, X → Y는 예측입니다. 외삽 경고와 잔차를 함께 확인하세요.",
    ],
    [
      "Enter standards and switch to Curve & samples for results. For pasted headers, enable First row contains column names.",
      "Choose linear, through-origin, exponential or increasing Hill. Hill requires at least five distinct positive X values.",
      "Invalid rows are never silently discarded. Correct them or turn off Use for that row to exclude it from fitting.",
      "Y → X estimates concentration; X → Y predicts signal. Review residuals and extrapolation warnings.",
    ],
  ],
  "image-measurer": [
    [
      "원본 PNG/JPEG를 올린 뒤 기준선 도구로 길이를 아는 대상을 드래그하고 실제 길이를 입력하세요.",
      "선·사각형·타원은 드래그해서 만들고 자유형은 경계를 따라 그립니다. 선택 도구로 이동하고 조절점을 드래그해 수정하세요.",
      "측정은 원본 픽셀 좌표를 사용하므로 화면 확대와 회전에 영향을 받지 않습니다.",
      "색상 도구는 선택한 색과 허용 오차로 원본 이미지 전체의 근사 면적을 계산합니다. 객체 자동 인식이 아닙니다.",
    ],
    [
      "Upload PNG/JPEG, draw a reference over a known length and enter its physical length.",
      "Drag to draw lines, rectangles and ellipses. Trace freehand boundaries. Select an item to move it or drag its handles.",
      "Measurements use original image pixels, independent of screen zoom or rotation.",
      "Color measurement estimates matching area across the original image using tolerance. It is not object recognition.",
    ],
  ],
  "gel-blot": [
    [
      "Lane은 사각형, band는 선으로 표시하세요. 선택한 항목의 이름이 라벨로 나타납니다.",
      "Library에서 만든 래더를 불러온 뒤 각 band의 위치를 이미지에 맞춰 조절하세요.",
    ],
    [
      "Mark lanes with rectangles and bands with lines. Item names become labels.",
      "Load a custom Library ladder, then align its bands with the image.",
    ],
  ],
  dilution: [
    [
      "계산할 값(원액 부피·최종 농도·최종 부피)을 고르고 나머지 값과 단위를 입력하세요. C1 × V1 = C2 × V2로 계산하며, 단위를 바꿔도 입력한 숫자는 그대로입니다.",
      "목표는 농도 대신 희석배수(1 : N)로도 지정할 수 있습니다. 10X 버퍼처럼 배수로 표시된 농도는 단위 X를 고르세요.",
      "원액과 목표가 몰농도와 질량농도로 서로 다르면 분자량을 입력하거나 시약 검색에서 가져오세요.",
      "결과 아래 제조 문장은 복사해 노트에 붙일 수 있습니다. 취할 원액이 0.5 µL보다 적으면 중간 희석 방법을 함께 안내합니다.",
      "연속 희석은 1단계를 위 결과대로 만든 뒤 정해진 배수로 앞 단계 용액을 옮기는 표입니다. 단계별 남는 양과 희석액 합계를 확인하고 CSV로 내보내거나 표를 복사하세요.",
    ],
    [
      "Choose what to solve for (stock volume, final concentration or final volume), then enter the other values and units. The tool uses C1 × V1 = C2 × V2; changing a unit keeps the number you typed.",
      "The target can be a dilution fold (1 : N) instead of a concentration. For strengths such as a 10X buffer, choose the unit X.",
      "When the stock is molar and the target is mass per volume, or the reverse, enter the molecular weight or take it from the reagent search.",
      "Copy the instruction under the result into your notes. When the stock volume is below 0.5 µL, an intermediate dilution is suggested.",
      "For serial dilution, make step 1 as calculated, then transfer from each previous step by the chosen fold. Check the volume left in each tube and the total diluent, then export CSV or copy the table.",
    ],
  ],
  molarity: [
    [
      "질량·몰수·질량농도 중 알고 있는 기준을 고르고, 계산할 값을 선택한 뒤 나머지 값과 단위를 입력하세요.",
      "단위를 바꿔도 입력한 숫자는 그대로이고 결과가 새 단위에 맞춰 다시 계산됩니다. 부피는 용해 후 최종 용액 부피입니다.",
      "분자량은 g/mol 또는 kDa로 직접 입력하거나 시약 검색에서 가져오세요. 수화물은 라벨에 인쇄된 화학식량을 사용하세요.",
      "순도가 100%가 아니면 순도를 입력하세요. 달아야 할 질량은 순수 질량을 순도로 나눈 값입니다.",
      "결과 아래 제조 문장을 복사하거나, ‘이 용액을 희석’으로 농도를 희석 도구에 보낼 수 있습니다.",
    ],
    [
      "Choose mass, moles or mass concentration as your basis, pick the value to solve for, then enter the other quantities and units.",
      "Changing a unit keeps the number you typed and recalculates the result. Volume means final solution volume after dissolving.",
      "Enter the molecular weight in g/mol or kDa, or take it from the reagent search. For a hydrate, use the formula weight printed on the label.",
      "If the reagent is not 100% pure, enter its purity. The mass to weigh is the pure mass divided by the purity.",
      "Copy the instruction under the result, or use Dilute this solution to send the concentration to the dilution tool.",
    ],
  ],
  timer: [
    [
      "시·분·초를 입력하거나 빠른 시간을 눌러 타이머를 추가한 뒤 시작을 누르세요. 이름은 비워 두어도 됩니다.",
      "‘빠른 시간 편집’에서 자주 쓰는 시간을 추가하거나 지울 수 있습니다. 최근에 시작한 시간도 함께 표시됩니다.",
      "시간이 다 되면 +00:35처럼 지난 시간을 계속 표시합니다. 다시 시작하거나 ‘종료 확인’을 누를 때까지 유지됩니다.",
      "실행 중인 타이머가 위에, 먼저 끝나는 순서로 놓입니다. 세포 배양에서 시작한 타이머도 함께 보입니다. 웹에서는 앱이 탭에 열려 있어야 알림이 울립니다.",
    ],
    [
      "Enter hours, minutes and seconds or tap a preset, add the timer, then press Start. The name is optional.",
      "Use Edit presets to add or remove the durations you use often. Durations you started recently are offered too.",
      "When time is up the timer keeps counting past zero, shown as +00:35, until you restart or dismiss it.",
      "Running timers come first, soonest to finish on top. Timers started in Cell Culture are listed as well. On the web, alerts need the app open in a tab.",
    ],
  ],
  stopwatch: [
    [
      "시작을 누르면 바로 측정합니다. 정지한 뒤 재개하면 이어서 측정합니다.",
      "측정 중에 랩을 누르면 그 구간의 시간과 누적 시간이 기록됩니다. 기록은 복사하거나 CSV로 내보낼 수 있습니다.",
      "초기화하면 시간과 랩 기록이 지워집니다. 바로 나타나는 실행 취소로 되돌릴 수 있습니다.",
    ],
    [
      "Press Start to begin timing. After a pause, Resume continues from where it stopped.",
      "While it runs, Lap records the time of that lap and the total. Copy the laps or export them as CSV.",
      "Reset clears the time and the laps. Undo, offered right after, brings them back.",
    ],
  ],
  alarm: [
    [
      "‘알람 추가’를 누르면 한 시간 뒤, 초 없이 분 단위로 맞춘 알람이 만들어집니다. 날짜와 시각을 바꾸세요.",
      "반복 요일을 고르면 매주 그 요일의 같은 시각에 울립니다. 요일을 고르지 않으면 한 번만 울립니다.",
      "울린 뒤 10분 동안은 5분 또는 10분 뒤에 다시 알리도록 할 수 있습니다. ‘지난 알람 정리’는 시각이 지난 일회성 알람을 한 번에 지웁니다.",
      "알람은 ‘이 기기에서 알림’을 켠 기기에서만 울립니다. 웹에서는 앱이 탭에 열려 있어야 알림이 울립니다.",
    ],
    [
      "Add alarm creates one an hour ahead, on the minute. Change its date and time.",
      "Pick repeat days to ring every week at that time. With no days picked it rings once.",
      "For 10 minutes after it rings you can snooze it for 5 or 10 minutes. Clear past alarms removes every one-off alarm whose time has passed.",
      "An alarm rings only on devices where Notify on this device is on. On the web, alerts need the app open in a tab.",
    ],
  ],
  "master-mix": [
    [
      "반응 수와 여유량을 입력하고 성분마다 반응당 양을 적으세요. 전체량은 반응당 양 × 반응 수 × (1 + 여유량)입니다.",
      "‘농도로 입력’을 켜면 원액 농도와 최종 농도(같은 단위), 반응 부피로 반응당 부피를 계산합니다.",
      "반응 부피를 입력하면 남는 부피를 물(또는 버퍼)로 채우는 행이 생깁니다. g·mg·µg 성분은 부피 합계에 넣지 않습니다.",
      "주형 DNA처럼 튜브마다 따로 넣는 성분은 ‘반응별 개별 첨가’를 켜세요. 마스터 믹스 합계에서 빠지고 튜브당 분주량이 그만큼 줄어듭니다.",
    ],
    [
      "Enter the number of reactions and the overage, then each component's amount per reaction. Totals are amount × reactions × (1 + overage).",
      "Turn on By concentration to get the volume per reaction from a stock and a final concentration in the same unit and the reaction volume.",
      "With a reaction volume set, a row fills the rest with water or buffer. Components in g, mg or µg are not counted in the volumes.",
      "Turn on Add per tube for components such as template DNA. They leave the master mix total, and the volume dispensed per tube shrinks by that much.",
    ],
  ],
  "medium-buffer": [
    [
      "레시피의 기준 제조량과 성분별 기준량을 입력한 뒤 목표 제조량을 바꾸세요. 모든 성분이 같은 비율로 환산됩니다.",
      "‘최종 농도로 입력’을 켜면 g/L, mg/mL, % w/v, M, mM 또는 X 농도에서 넣을 질량이나 부피를 계산합니다. M·mM은 분자량이 필요하며 시약 검색으로 채울 수 있습니다.",
      "성분을 넣을 때마다 ‘완료’를 누르고 아래 제조 단계를 순서대로 확인하세요. 단계는 고치거나 추가할 수 있습니다.",
      "제조량을 바꾸면 완료 표시가 지워집니다. 확인한 양이 더 이상 화면의 양과 같지 않기 때문입니다.",
    ],
    [
      "Enter the recipe's reference volume and each component's amount for it, then change the target volume. Every component scales by the same ratio.",
      "Turn on By final concentration to get the mass or volume to add from g/L, mg/mL, % w/v, M, mM or X. M and mM need a molecular weight, which reagent search can fill in.",
      "Tick Done as you add each component, then work through the preparation steps below. Steps can be edited or added.",
      "Changing a volume clears the Done marks, because the amounts you confirmed are no longer the amounts shown.",
    ],
  ],
  calendar: [
    [
      "월·주·목록에서 일정을 선택해 편집하세요. 반복 일정은 지정 시간대의 시각을 유지합니다.",
      "반복 중 제외할 시각은 실제 발생 시각으로 입력하세요. 이 기기 알림을 켜야 알림이 예약됩니다.",
      "ICS는 UTC·IANA 시간대와 일·주·월 반복을 지원합니다. 지원하지 않는 규칙은 오류로 안내합니다.",
    ],
    [
      "Select an event in month, week or list view. Recurrence preserves its wall-clock time in the selected timezone.",
      "Exclude an exact occurrence time. Enable notifications on this device to schedule reminders.",
      "ICS supports UTC and IANA timezones with daily, weekly or monthly recurrence. Unsupported rules are reported.",
    ],
  ],
  "plate-labelling": [
    [
      "웰을 누르면 저장된 내용을 편집할 수 있습니다. 다중 선택이나 행·열 머리글로 여러 웰을 선택하고 한 번에 적용하세요. 복사·붙여넣기 후에는 적용을 눌러 저장하세요. 플레이트 크기를 바꿔도 기존 배치는 보존됩니다.",
    ],
    [
      "Select a well to edit its saved labels. Use multi-select or row and column headers to apply labels in bulk. After pasting, apply to save. Existing labels are retained when changing plate size.",
    ],
  ],
  "cell-counter": [
    [
      "각 구획의 생존·사멸 세포 수를 입력하세요. 결과는 평균 계수량과 구획당 부피, 희석배수로 계산합니다.",
      "기본 부피 0.0001 mL는 장비와 계수 구획에 맞는지 확인하세요.",
    ],
    [
      "Enter live and dead cells per counted chamber. Concentration uses average counts, counted volume and dilution factor.",
      "Check that the default 0.0001 mL volume matches your chamber and counted area.",
    ],
  ],
  counter: [
    [
      "단일 카운터는 한 가지를, 다중 카운터는 최대 12개 항목을 나눠 셉니다. 큰 영역을 누르면 더하고 왼쪽 위 − 버튼으로 뺍니다.",
      "오른쪽 위 연필 버튼으로 값을 직접 입력합니다. 설정에서 한 번에 세는 수(예: 5, 10)를 정하고 항목을 추가·삭제하거나 이름을 바꿉니다.",
      "키보드: 1–9는 해당 항목에 더하고 Shift와 함께 누르면 뺍니다. Space·Enter는 선택한 항목에 더하고 Backspace는 실행 취소입니다.",
      "최근 20번의 변경은 카운터와 함께 저장되어 다시 열어도 실행 취소할 수 있습니다. 결과는 한 줄 텍스트로 복사하거나 CSV로 내보냅니다.",
    ],
    [
      "A single counter counts one thing; a multi counter splits up to 12 items. Tap the large area to add and the − button at the top left to subtract.",
      "Type a value with the pencil button at the top right. In settings, choose how much one press counts (5 or 10, say) and add, remove or rename items.",
      "Keyboard: 1–9 add to that item, with Shift they subtract. Space and Enter add to the selected item; Backspace undoes.",
      "The last 20 changes are saved with the counter, so they can be undone after reopening it. Copy the result as one line of text or export CSV.",
    ],
  ],
};
export default function ToolGuide({ id }: { id: ToolId }) {
  const t = useText(),
    guide = guides[id];
  if (!guide) return null;
  return (
    <details className="tool-guide">
      <summary>{t("사용 방법", "How to use")}</summary>
      <ol>
        {t(guide[0].join("\n"), guide[1].join("\n"))
          .split("\n")
          .map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </details>
  );
}
