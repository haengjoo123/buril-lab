import type { ToolId } from "./registry";
import { useText } from "./ui";
const guides: Partial<Record<ToolId, [string[], string[]]>> = {
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
  "custom-equation": [
    [
      "a * b + c처럼 수식을 입력하면 변수 입력란이 생깁니다. 2, 3, 1을 입력하면 결과는 7입니다.",
      "잠금은 상수처럼 유지할 값에 사용하세요. 초기화는 잠기지 않은 변수만 비웁니다. 0은 입력된 값으로 취급합니다.",
      "sin/cos/tan은 RAD 또는 DEG 설정을 따릅니다. log10은 상용로그, ln은 자연로그이고 25%는 0.25입니다.",
      "소수 자릿수는 표시만 바꿉니다. 단위와 출처는 메모에 남기세요.",
    ],
    [
      "Enter a formula such as a * b + c to generate variable inputs. Values 2, 3 and 1 produce 7.",
      "Lock constants to keep them when resetting other inputs. Zero is a valid input; blank means missing.",
      "Trigonometry follows RAD/DEG. log10 is base 10; ln is natural log; 25% means 0.25.",
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
      "원액 농도, 목표 농도, 최종 부피를 입력하세요. 농도 단위는 서로 호환되어야 합니다.",
      "연속 희석은 첫 용액을 목표 농도로 만든 뒤 정해진 배수로 이전 용액을 옮기는 표입니다.",
    ],
    [
      "Enter stock concentration, target concentration and final volume using compatible concentration units.",
      "For serial dilution, prepare the first solution at the target concentration, then transfer from each previous dilution.",
    ],
  ],
  molarity: [
    [
      "계산할 값을 고른 뒤 나머지 값과 단위를 입력하세요. 시약 검색으로 분자량을 가져올 수 있습니다.",
      "질량·몰수·질량농도 중 알고 있는 기준을 선택하세요. 단위를 바꾸면 같은 양으로 환산합니다. 부피는 용해 후 최종 용액 부피입니다.",
    ],
    [
      "Choose the value to solve for, then enter the other quantities and units. Reagent search can supply molecular weight.",
      "Choose mass, moles or mass concentration as your basis. Unit changes preserve quantities. Volume means final solution volume after dissolving.",
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
};
export default function ToolGuide({ id }: { id: ToolId }) {
  const t = useText(),
    guide = guides[id];
  if (!guide) return null;
  return (
    <details className="tool-guide">
      <summary>{t("사용 방법", "How to use")}</summary>
      <ol>
        {(guide
          ? t(guide[0].join("\n"), guide[1].join("\n")).split("\n")
          : [
              t(
                "도구를 열고 바로 사용하세요. 입력은 기기에 보관되며, 다시 쓸 작업은 작업 저장으로 계정에 보관할 수 있습니다. 결과를 사용하기 전에 단위를 확인하세요.",
                "Start using the tool immediately. Inputs are kept on this device; save reusable work to your account. Check units before using results."
              ),
            ]
        ).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </details>
  );
}
