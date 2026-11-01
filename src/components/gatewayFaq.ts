// Visible FAQ on the landing page. The Korean entries are mirrored in the
// FAQPage JSON-LD in index.html and in public/llms.txt; scripts/crawler-files.test.ts keeps
// them in sync, so update all three together.
export type GatewayFaqItem = { question: string; answer: string };

export const gatewayFaq: Record<'ko' | 'en', GatewayFaqItem[]> = {
  ko: [
    {
      question: '버릴랩은 어떤 서비스인가요?',
      answer:
        '버릴랩은 연구실에서 쓰고 남은 시약(폐시약)을 어떻게 폐기해야 하는지 찾아보고, 시약 재고와 시약장 보관 위치, 폐기 기록을 함께 관리하는 연구실 안전 관리 서비스입니다.',
    },
    {
      question: '시약은 어떻게 검색하나요?',
      answer:
        '시약명(국문·영문), CAS 번호, 제품명으로 검색할 수 있습니다. 시약병 라벨을 카메라로 찍어 인식하거나 음성으로 질문할 수도 있습니다.',
    },
    {
      question: '폐기 기준과 GHS 정보는 어디에서 가져오나요?',
      answer:
        '한국산업안전보건공단(KOSHA) MSDS와 PubChem 같은 공개 자료를 바탕으로 GHS 주의사항과 폐액 분류 방향을 보여줍니다. 참고 정보이므로 실제 폐기 전에는 최신 MSDS와 소속 기관의 폐기물 처리 규정을 함께 확인해야 합니다.',
    },
    {
      question: '이용 요금이 있나요?',
      answer: '현재 모든 기능을 무료로 제공하며 결제를 받지 않습니다. 유료 기능을 도입하게 되면 결제 전에 가격과 환불 조건을 먼저 안내합니다.',
    },
    {
      question: '통합안전관리센터는 누가 사용하나요?',
      answer:
        '대학·기관의 안전관리 담당자가 승인된 여러 연구실의 만료 임박 시약, 고위험 재고, 확인 요청 응답 현황을 한 화면에서 보고 점검 자료를 내보낼 때 사용합니다.',
    },
  ],
  en: [
    {
      question: 'What is Buril Lab?',
      answer:
        'Buril Lab is a lab safety service for finding out how to dispose of leftover reagents and for managing reagent inventory, cabinet storage locations, and disposal records together.',
    },
    {
      question: 'How do I search for a reagent?',
      answer:
        'Search by reagent name (Korean or English), CAS number, or product name. You can also scan a bottle label with your camera or ask by voice.',
    },
    {
      question: 'Where do disposal guidance and GHS data come from?',
      answer:
        'GHS precautions and waste category guidance are based on public sources such as KOSHA MSDS and PubChem. Treat them as reference information and check the current MSDS and your institution’s waste rules before disposal.',
    },
    {
      question: 'Does it cost anything?',
      answer: 'All features are currently free and no payments are taken. If paid features are introduced, prices and refund terms will be shown before any purchase.',
    },
    {
      question: 'Who uses the Safety Center?',
      answer:
        'Safety managers at universities and institutions use it to review expiring reagents, high-risk inventory, and request responses across approved labs, and to export inspection material.',
    },
  ],
};
