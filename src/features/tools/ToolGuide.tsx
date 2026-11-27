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
      "세포주 설정에서 배양 방식과 배가 시간을 정하세요. 부착세포는 100% confluence에서의 밀도가, 부유세포는 최대 밀도가 필요합니다.",
      "분주 계산에 세포 농도와 보유 부피를 입력하세요. 세포 계수 도구에서 보낸 농도는 ‘적용’을 누르면 들어옵니다.",
      "용기 프리셋을 고르면 성장 면적과 배지 부피가 채워지고, 값은 고칠 수 있습니다. 플레이트는 웰 하나 기준이므로 용기 개수에 분주할 웰 수를 넣으세요. 목표 방식은 농도, 용기당 세포수, 면적당 세포수, confluence 또는 split입니다.",
      "계대할 때마다 기록을 추가하면 번호가 하나씩 올라갑니다. 첫 기록의 번호는 시작 계대 번호로 정하고, 기록은 번호·일시·내용을 수정하거나 삭제할 수 있습니다. 분주 계산에서 모든 용기를 완료하면 계산 결과도 함께 저장되며, 기록은 CSV로 내보냅니다.",
      "성장 곡선은 지연기가 없는 지수 성장 모델의 예상이며 실측이 아닙니다. 예상 시점에 타이머를 시작하거나 다음 계대를 캘린더에 추가할 수 있습니다. 타이머를 시작한 뒤 세포주 설정을 바꿔도 예약 시각은 유지됩니다.",
    ],
    [
      "Set the culture type and doubling time in the cell line profile. Adherent cultures need the density at 100% confluence, suspension cultures the maximum density.",
      "Enter the cell concentration and available volume in the seeding calculator. A density sent from the Cell Counter is taken when you press Apply.",
      "A vessel preset fills in the growth area and medium volume, and both can be changed. Plates are per well, so enter the number of wells to seed as the vessel count. Targets are concentration, cells per vessel, cells per area, confluence or split.",
      "Add a record at each passage and the number goes up by one. The starting passage number sets the first record's number; a record's number, date and details can be edited, or the record deleted. Complete all vessel checks to include the seeding calculation, and export the log as CSV.",
      "The growth curve is an estimate from an exponential model without a lag phase, not a measurement. Start a timer for the estimated time or add the next passage to the calendar. Starting a timer fixes its target time even if the profile changes.",
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
      "표준값을 입력하고 그래프·시료 탭에서 결과를 확인하세요. 스프레드시트의 X, Y 두 열을 붙여 넣을 수 있고 0,5 같은 쉼표 소수점도 읽습니다. 첫 행이 제목이면 ‘첫 행은 열 이름’을 켜세요.",
      "같은 X를 여러 행에 넣으면 반복 측정입니다. 평균·SD·n을 보여 주지만 적합에는 평균이 아니라 측정값을 하나씩 모두 사용합니다.",
      "선형·원점 고정·지수·증가형 Hill·감소형 Hill 중 선택하세요. Hill은 4PL(4-매개변수 로지스틱)이며 서로 다른 양수 X가 최소 5개 필요합니다. 농도가 높을수록 신호가 줄어드는 경쟁 분석은 감소형을 고르세요.",
      "오류 행은 자동으로 제외되지 않습니다. 값을 수정하거나 해당 행의 ‘사용’을 꺼 적합에서 제외하세요. 빈칸이 있으면 채울 때까지 적합하지 않습니다.",
      "잔차 그림에서 점이 0의 한쪽에 몰려 있거나 휘어 있으면 모델이 자료에 맞지 않는 것입니다. RMSE는 잔차 제곱합을 n − p(측정값 수 − 매개변수 수)로 나눈 값의 제곱근입니다.",
      "시료에서 Y → X는 역산, X → Y는 예측입니다. ‘여러 시료 붙여넣기’에 Y값 열만, 또는 이름과 Y값 두 열을 붙여 넣으세요. 표준 범위 밖 시료는 그래프에 빈 마름모와 점선으로, 표에는 외삽으로 표시됩니다.",
      "플레이트 라벨링에서 보낸 배치를 적용하면 표준(농도 입력됨)과 시료 행이 추가됩니다. 측정한 Y값을 채우세요.",
    ],
    [
      "Enter standards and switch to Curve & samples for results. You can paste the X and Y columns of a spreadsheet, and a decimal comma such as 0,5 is read. For pasted headers, enable First row contains column names.",
      "Rows that repeat an X are replicates. Their mean, SD and n are shown, but the fit uses every measurement, not the means.",
      "Choose linear, through-origin, exponential, increasing Hill or decreasing Hill. Hill is the 4PL (four-parameter logistic) and requires at least five distinct positive X values. Pick decreasing for competitive assays, where signal falls as concentration rises.",
      "Invalid rows are never silently discarded. Correct them or turn off Use for that row to exclude it from fitting. Nothing is fitted while a value is still empty.",
      "In the residual plot, points gathered on one side of zero or in a bend mean the model does not suit the data. RMSE is the square root of the squared residuals summed and divided by n − p (measurements − parameters).",
      "Y → X estimates concentration; X → Y predicts signal. Under Paste several samples, paste a column of Y values or a name column and a Y column. Samples outside the standard range are drawn as hollow diamonds on a dashed line and marked as extrapolation in the table.",
      "Applying a layout sent from Plate Labelling adds its standards, with their concentrations, and its samples. Fill in the measured Y values.",
    ],
  ],
  "image-measurer": [
    [
      "원본 PNG/JPEG를 올린 뒤 기준선 도구로 길이를 아는 대상을 드래그하고 실제 길이를 입력하세요.",
      "선·사각형·타원은 드래그해서 만들고 자유형은 경계를 따라 그립니다. 선택 도구로 이동하고 조절점을 드래그해 수정하세요.",
      "측정은 원본 픽셀 좌표를 사용하므로 화면 확대와 회전에 영향을 받지 않습니다.",
      "각도 도구는 한쪽 끝, 꼭짓점, 다른 쪽 끝 순서로 세 점을 눌러 꼭짓점의 각도(0~180°)를 잽니다. 점 계수 도구는 누를 때마다 번호가 붙은 점을 남기고 개수를 셉니다. 종류가 다른 대상은 ‘새 그룹으로 세기’를 눌러 따로 세세요.",
      "같은 종류의 측정이 여러 개면 표 아래에 개수·평균·표준편차(n−1)가 나오고, 3개부터는 값의 퍼짐을 막대로 보여 줍니다.",
      "색상 도구는 선택한 색과 허용 오차로 원본 이미지 전체의 근사 면적을 계산합니다. 객체 자동 인식이 아닙니다.",
      "실행 취소는 Ctrl/⌘+Z, 다시 실행은 Ctrl/⌘+Shift+Z 또는 Ctrl+Y입니다. 그리던 도형은 Esc로 취소합니다.",
    ],
    [
      "Upload PNG/JPEG, draw a reference over a known length and enter its physical length.",
      "Drag to draw lines, rectangles and ellipses. Trace freehand boundaries. Select an item to move it or drag its handles.",
      "Measurements use original image pixels, independent of screen zoom or rotation.",
      "The Angle tool takes three clicks (one end, the vertex, the other end) and gives the angle at the vertex, 0–180°. The Count tool leaves a numbered point at every click and totals them. Use Start a new group to count a second kind of object separately.",
      "With several measurements of one kind, the count, mean and standard deviation (n−1) appear under the table; from three on, bars show how the values spread.",
      "Color measurement estimates matching area across the original image using tolerance. It is not object recognition.",
      "Undo with Ctrl/⌘+Z and redo with Ctrl/⌘+Shift+Z or Ctrl+Y. Esc cancels a shape being drawn.",
    ],
  ],
  "gel-blot": [
    [
      "Lane은 사각형, band는 선으로 표시하세요. 선택한 항목의 이름이 라벨로 나타납니다.",
      "레인 나누기 도구로 레인 전체를 한 번에 끌면 입력한 수만큼 같은 폭의 레인이 왼쪽부터 1번으로 만들어집니다. 이름은 레인을 선택해 바꿀 수 있습니다.",
      "Library에서 만든 래더를 불러온 뒤 각 band를 이미지의 실제 래더 밴드 위로 옮기세요. 래더를 직접 표시했다면 밴드를 선택해 알려진 크기를 입력하세요.",
      "크기가 있는 래더 밴드가 2개 이상이면 나머지 밴드의 크기를 추정합니다. 이웃한 두 래더 밴드 사이를 log 크기 대 이동 거리의 직선으로 읽으며, 이동 방향은 화면의 위에서 아래입니다. 옆으로 찍힌 사진은 먼저 회전하세요.",
      "래더 범위 밖의 밴드는 ‘외삽’으로 표시되며 오차가 큽니다. 추정값은 손으로 표시한 위치에서 나온 근삿값이고, 밴드 밝기 정량과 자동 검출은 제공하지 않습니다.",
    ],
    [
      "Mark lanes with rectangles and bands with lines. Item names become labels.",
      "With the Split lanes tool, drag once across all the lanes to make the number you entered, equal in width and numbered from 1 at the left. Select a lane to rename it.",
      "Load a custom Library ladder, then move each band onto the real ladder band in the image. For a ladder you marked by hand, select each band and enter its known size.",
      "With two or more sized ladder bands, the size of every other band is estimated: a straight line of log size against distance between the two neighbouring ladder bands, with migration running down the screen. Rotate a sideways photo first.",
      "A band outside the ladder is marked extrapolated and can be far off. Estimates are approximations from hand-placed marks; band intensity and automatic detection are not provided.",
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
      "월·주 보기에서 날짜를 누르면 그 날짜 오전 9시에 새 일정이 만들어집니다. ‘일정 추가’는 지금부터 한 시간 뒤로 만듭니다. 일정을 누르면 아래에서 편집합니다.",
      "‘종일’을 켜면 시각 없이 시작일과 종료일만 정합니다. 여러 날에 걸친 일정은 그 사이 모든 날짜에 표시됩니다. 오늘은 굵은 테두리와 ‘오늘’ 표시로, 다른 달 날짜는 흐리게 구분합니다.",
      "반복 일정은 지정 시간대의 시각을 유지합니다. 반복 중 한 번을 빼려면 그 발생 시각(종일 일정은 날짜)을 제외에 추가하세요.",
      "‘이 기기에서 알림’을 켠 기기에서만 알림이 옵니다. 종일 일정의 알림은 첫날 0시 기준이므로 전날 오전 9시 같은 시각을 고르세요.",
      "ICS 가져오기는 읽을 수 있는 일정만 가져오고, 가져오지 못한 일정은 이유와 함께 하나씩 알려 줍니다. 종일 일정, UTC·IANA 시간대, 매일·매주·매월 반복과 종료일을 지원하며, 같은 파일을 다시 가져오면 기존 일정을 갱신합니다.",
    ],
    [
      "In month or week view, press a date to add an event at 09:00 that day. Add event makes one an hour from now. Press an event to edit it below.",
      "Turn on All day to set only a start and an end date. An event that spans several days is shown on every one of them. Today has a heavier border and a Today label; days of other months are dimmed.",
      "A repeating event keeps its clock time in the chosen timezone. To skip one occurrence, add its time (its date, for an all-day event) under exclusions.",
      "Reminders arrive only on devices where Notify on this device is on. An all-day event reminds relative to 00:00 on its first day, so pick a time such as 09:00 the day before.",
      "Import ICS brings in every event it can read and lists each one it could not, with the reason. All-day events, UTC and IANA timezones, and daily, weekly or monthly repeats with an end date are supported; importing the same file again updates the events already here.",
    ],
  ],
  notes: [
    [
      "‘메모 추가’로 메모를 만들고 제목·태그·본문을 쓰세요. 입력하는 대로 저장됩니다.",
      "태그는 입력한 뒤 Enter나 쉼표로 추가하고 ×로 지웁니다. 목록 위의 태그를 누르면 그 태그가 붙은 메모만 보이고, 정렬은 최근 수정순과 제목순 중에서 고릅니다.",
      "아직 제목을 붙이지 않은 메모는 ‘본문 첫 줄을 제목으로’를 눌러 첫 줄을 제목으로 쓸 수 있습니다. 제목이 저절로 바뀌지는 않습니다.",
      "‘저장한 작업 연결’로 다른 도구에서 저장한 작업을 메모에 붙이면, 도구 종류와 함께 목록에 나오고 누르면 그 작업이 열립니다.",
      "‘텍스트 내보내기’는 제목, 태그, 본문을 한 파일로 저장합니다. 휴지통으로 옮긴 메모는 목록 아래 휴지통에서 복원합니다.",
    ],
    [
      "Press Add note, then write a title, tags and the body. Everything is saved as you type.",
      "Add a tag with Enter or a comma and remove it with ×. Press a tag above the list to see only the notes that carry it, and sort by last edit or by title.",
      "A note you have not titled yet offers Use first line as title. The title never changes by itself.",
      "Link saved work attaches work saved in another tool. It is listed with the kind of tool, and opens when pressed.",
      "Export text saves the title, tags and body in one file. A note moved to the trash can be restored from Trash below the list.",
    ],
  ],
  ladders: [
    [
      "종류(DNA·RNA·단백질)와 단위를 고른 뒤 밴드를 입력하세요. 밴드 자료는 내장되어 있지 않으므로 사용하는 제품의 설명서를 보고 입력합니다.",
      "‘목록 붙여넣기’에 설명서의 크기 목록을 그대로 붙이면 한 번에 가져옵니다. 줄바꿈·쉼표·탭·공백으로 나누고 10,000의 쉼표는 천 단위로, 1.5 kb·500 bp·250 kDa는 래더 단위로 환산합니다. 해석하지 못한 항목은 개수와 함께 보여 줍니다.",
      "밴드마다 색을 고르고, 기준이 되는 굵은 밴드는 ‘강조’를 켜세요. 젤/블롯 도구에서 이 래더를 불러오면 강조한 밴드가 더 길게 표시됩니다.",
      "‘제조사·제품 정보’에 공식 자료 주소(https://…)를 넣으면 새 탭으로 여는 링크가 생깁니다.",
      "도식은 크기의 로그 간격으로 그린 것으로 실제 이동 거리와 다릅니다. ‘도식 PNG’로 그림을, CSV로 밴드 표를 내보냅니다.",
    ],
    [
      "Choose the type (DNA, RNA or protein) and the unit, then enter the bands. No ladder data is built in: enter the bands from your product's sheet.",
      "Paste a list takes the size list from the sheet as it is. Values are split at line breaks, commas, tabs and spaces; the comma in 10,000 groups thousands, and 1.5 kb, 500 bp or 250 kDa are converted to the ladder's unit. Items that could not be read are counted and shown.",
      "Pick a colour for each band and turn on Highlight for the heavier reference bands. When the Gel / Blot tool loads this ladder, highlighted bands are drawn longer.",
      "Under Manufacturer and product details, an official address (https://…) becomes a link that opens in a new tab.",
      "The diagram spaces bands by the logarithm of their size; it is not the actual migration. Diagram PNG exports the picture and CSV the band table.",
    ],
  ],
  "plate-labelling": [
    [
      "웰을 누르거나 끌어서 선택하세요. Shift+클릭은 범위를 넓히고 행·열 머리글은 한 줄을 선택합니다. 키보드에서는 방향키로 옮기고 Shift+방향키로 범위를 넓히며 Enter나 Space로 선택합니다. 터치 화면에서는 다중 선택을 켜야 끌어서 선택됩니다.",
      "편집 칸에서 고친 항목만 선택한 웰에 적용됩니다. 색만, 역할만, 농도만 바꿔도 나머지 내용은 웰마다 그대로 남습니다. 복사·붙여넣기 후에는 적용을 눌러 저장하세요.",
      "연속 채우기는 선택한 범위에 희석 계열(시작 농도와 희석배수)이나 반복 번호(S1, S2 …)를 행 또는 열 방향으로 넣습니다.",
      "농도는 플레이트 공통 단위의 숫자입니다. 농도 보기는 농도를 한 색의 농담으로 칠하고, 여러 자릿수에 걸친 희석 계열은 로그 간격으로 칠합니다.",
      "웰 내용은 실행 취소(Ctrl/Cmd+Z)와 다시 실행으로 여러 단계 되돌립니다. 이력은 이 화면을 열어 둔 동안만 유지됩니다. 플레이트 크기를 바꿔도 기존 배치는 보존됩니다.",
      "배치도는 CSV·PNG·PDF로 내보냅니다. 역할을 준 웰은 검량선으로, 사용 웰 수는 마스터 믹스로 보낼 수 있습니다.",
    ],
    [
      "Click or drag across wells to select them. Shift+click extends the range, and a row or column header selects its line. On a keyboard, the arrow keys move, Shift+arrow extends the range, and Enter or Space selects. On a touch screen, turn Multi-select on to select by dragging.",
      "Only the fields you change in the editor are applied to the selected wells. Change just the color, role or concentration and everything else stays as it is in each well. After pasting, apply to save.",
      "Fill a series puts a dilution series (starting concentration and factor) or numbered samples (S1, S2 …) into the selection, along rows or down columns.",
      "A concentration is a number in the plate's one unit. The concentration view shades wells in one hue, on a log scale when a dilution series spans orders of magnitude.",
      "Undo (Ctrl/Cmd+Z) and Redo step back and forth through changes to wells. The history lasts while this screen is open. Existing labels are retained when changing plate size.",
      "Export the layout as CSV, PNG or PDF. Wells with a role can be sent to the Calibration Curve, and the number of wells in use to the Master Mix.",
    ],
  ],
  "cell-counter": [
    [
      "계수판과 세는 구획을 고르세요. Neubauer improved의 큰 사각형 하나는 0.1 µL라서, 센 세포 1개가 희석 전 10,000 cells/mL에 해당합니다. 목록에 없는 계수판은 ‘직접 입력’을 골라 구획당 부피(µL)를 넣으세요.",
      "희석배수를 입력하세요. 트리판 블루와 1 : 1로 섞었다면 2입니다.",
      "생존·사멸 버튼을 눌러 세고, 오른쪽 화살표로 다음 구획으로 넘어갑니다. 잘못 눌렀으면 −1이나 실행 취소를 누르세요. 집중 모드는 계수 버튼만 화면 가득 보여 줍니다. 아래 칸에 숫자를 직접 입력해도 됩니다.",
      "생존 세포 농도는 구획 평균 생존 세포 수 ÷ 구획당 부피 × 희석배수입니다. 현탁액 부피를 넣으면 총 생존 세포 수도 계산합니다. 세지 않은 빈 구획은 평균을 낮추므로 삭제하세요.",
      "결과는 한 문장으로 복사하거나, ‘세포 배양으로 보내기’로 분주 계산에 넘길 수 있습니다.",
    ],
    [
      "Choose the chamber and the square you count. One large square of a Neubauer improved chamber holds 0.1 µL, so one cell counted stands for 10,000 cells/mL before dilution. For a chamber that is not listed, choose Custom volume and enter the volume above one square in µL.",
      "Enter the dilution factor: 2 when the sample was mixed 1 : 1 with trypan blue.",
      "Tap Live and Dead to count, and the right arrow to move to the next square. After a slip, press −1 or Undo. Focus mode shows only the counting buttons, full screen. Counts can also be typed in the fields below.",
      "Viable density is the mean live count per square ÷ the volume above a square × the dilution factor. Enter the suspension volume to get the total viable cells. Remove a square that was added but not counted, because it lowers the mean.",
      "Copy the result as one sentence, or use Send to Cell Culture to pass the density to the seeding calculator.",
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
  "amino-acids": [
    [
      "이름, 한 글자·세 글자 약어 또는 곁사슬 분류로 찾고 카드를 누르면 구조식과 성질을 볼 수 있습니다.",
      "상세 화면에는 유리 분자량, 잔기 질량(물 한 분자를 뺀 값), pKa, pI, 소수성 지수와 출처가 나옵니다. pKa와 pI는 유리 아미노산의 값입니다.",
      "‘성질 비교’에서 잔기 질량·pI·소수성 지수 중 하나를 골라 막대로 비교하고 값순이나 이름순으로 정렬하세요. ‘표로 보기’에서 같은 값을 표로 볼 수 있습니다.",
      "상세 화면의 ‘코돈 도구에서 보기’는 그 아미노산의 코돈을 코돈 도구에서 엽니다.",
    ],
    [
      "Find an amino acid by name, one- or three-letter code or side-chain class, then select its card for the structure and properties.",
      "The detail view lists the free molecular weight, residue mass (less one water), pKa, pI and hydropathy index with their sources. pKa and pI are values for the free amino acid.",
      "Under Compare properties, choose residue mass, pI or hydropathy index to compare as bars, sorted by value or by name. View as table shows the same values.",
      "Open in the codon tool, in the detail view, shows that amino acid's codons in the codon tool.",
    ],
  ],
  codons: [
    [
      "코돈(AUG 또는 ATG), 아미노산의 한 글자·세 글자 약어나 이름, stop으로 검색하세요. 정확히 일치하는 결과가 먼저, 부분 일치가 그 뒤에 나옵니다.",
      "GCN처럼 N을 쓰면 그 자리에 어떤 염기가 와도 되는 코돈을 모두 찾습니다. 휠의 안쪽 칸을 눌러도 같은 방식으로 찾습니다.",
      "코돈 휠은 키보드로도 다룰 수 있습니다. ← →로 같은 고리 안에서, ↑ ↓로 안쪽·바깥쪽 고리로 옮기고 Enter로 선택합니다.",
      "‘서열 번역’에 DNA나 RNA 서열을 붙여 넣으면 세 읽기틀(+1, +2, +3)의 번역과 역상보 가닥을 보여 줍니다. 종결 코돈은 *, 읽을 수 없는 코돈은 X입니다.",
      "검색 결과 아래의 아미노산 정보 버튼은 아미노산 도구에서 그 아미노산을 엽니다.",
    ],
    [
      "Search by codon (AUG or ATG), by an amino acid's one- or three-letter code or name, or by stop. Exact matches come first, partial matches after them.",
      "Write N for any base: GCN finds every codon that starts with GC. Selecting an inner sector of the wheel searches the same way.",
      "The wheel works from the keyboard: ← → move around a ring, ↑ ↓ move to the inner or outer ring, and Enter selects.",
      "Paste a DNA or RNA sequence under Translate to see its three reading frames (+1, +2, +3) and its reverse complement. * is a stop codon and X a codon that cannot be read.",
      "The amino acid details button under the results opens that amino acid in the amino acid tool.",
    ],
  ],
  "periodic-table": [
    [
      "‘분자량 계산’에서 화학식을 입력하면 분자량과 원소별 개수·질량 기여·질량 백분율을 계산합니다. 괄호는 겹쳐 쓸 수 있고 수화물은 CuSO4·5H2O처럼 · . * 로 잇습니다. 원소 기호는 대소문자를 구분합니다.",
      "‘몰농도로 보내기’는 계산한 분자량을 몰농도 도구로 보냅니다.",
      "이름·기호·원자번호로 검색하거나 분류로 걸러 낸 뒤 원소를 누르면 족·주기와 물성을 볼 수 있습니다. 이전·다음 버튼은 검색과 분류에 맞는 원소 안에서 움직입니다.",
      "‘칸 색’에서 원자량·전기음성도·밀도 같은 물성을 고르면 값의 크기를 한 색의 농담으로 칠합니다. 값이 없는 원소는 비워 둡니다.",
      "표 안에서는 방향키로 칸을 옮기고 Enter로 선택합니다. 빈 칸은 건너뜁니다.",
    ],
    [
      "Under Molecular weight, enter a formula to get its weight with each element's atom count, mass and mass percent. Brackets may be nested and a hydrate is joined with · . or *, as in CuSO4·5H2O. Element symbols are case-sensitive.",
      "Send to Molarity passes the calculated weight to the molarity tool.",
      "Search by name, symbol or atomic number, or filter by family, then select an element for its group, period and properties. Previous and Next stay within the elements that match the search and family.",
      "Under Cell colour, choose a property such as atomic mass, electronegativity or density to shade the cells by its value in one hue. Elements without a value are left blank.",
      "Inside the table the arrow keys move between cells and Enter selects. Empty cells are skipped.",
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
