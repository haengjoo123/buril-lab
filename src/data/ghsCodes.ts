// H-Code to Korean Translation Dictionary
export const GHS_KO: Record<string, string> = {
    // Physical Hazards (H200–H290)
    "H200": "불안정 폭발성 물질",
    "H201": "폭발성 물질 (대량 폭발 위험)",
    "H202": "폭발성 물질 (심각한 분출 위험)",
    "H203": "폭발성 물질 (화재, 폭풍 또는 분출 위험)",
    "H204": "화재 또는 투척 위험",
    "H205": "화재 시 대량 폭발 가능성",
    "H220": "극인화성 가스",
    "H221": "인화성 가스",
    "H222": "극인화성 에어로졸",
    "H223": "인화성 에어로졸",
    "H224": "극인화성 액체 및 증기",
    "H225": "고인화성 액체 및 증기",
    "H226": "인화성 액체 및 증기",
    "H227": "가연성 액체",
    "H228": "인화성 고체",
    "H240": "가열 시 폭발할 수 있음",
    "H241": "가열 시 화재 또는 폭발할 수 있음",
    "H242": "가열 시 화재를 일으킬 수 있음",
    "H250": "공기에 노출되면 스스로 발화함",
    "H251": "자기발열성; 화재를 일으킬 수 있음",
    "H252": "다량인 경우 자기발열성; 화재를 일으킬 수 있음",
    "H260": "물과 접촉 시 자연발화성 인화성 가스를 발생시킴",
    "H261": "물과 접촉 시 인화성 가스를 발생시킴",
    "H270": "화재를 일으키거나 강렬하게 함 (산화제)",
    "H271": "화재 또는 폭발을 일으킬 수 있음 (강산화제)",
    "H272": "화재를 강렬하게 할 수 있음 (산화제)",
    "H280": "고압가스; 가열 시 폭발할 수 있음",
    "H281": "냉동액화가스; 극저온 화상 또는 상해를 입을 수 있음",
    "H290": "금속을 부식시킬 수 있음",

    // Health Hazards (H300–H373)
    "H300": "삼키면 치명적임",
    "H301": "삼키면 유독함",
    "H302": "삼키면 유해함",
    "H303": "삼키면 유해할 수 있음",
    "H304": "삼켜서 기도로 유입되면 치명적일 수 있음",
    "H305": "삼켜서 기도로 유입되면 유해할 수 있음",
    "H310": "피부와 접촉하면 치명적임",
    "H311": "피부와 접촉하면 유독함",
    "H312": "피부와 접촉하면 유해함",
    "H313": "피부와 접촉하면 유해할 수 있음",
    "H314": "피부에 심각한 화상과 눈에 손상을 일으킴",
    "H315": "피부에 자극을 일으킴",
    "H316": "경미한 피부 자극을 일으킴",
    "H317": "알레르기성 피부 반응을 일으킬 수 있음",
    "H318": "눈에 심각한 손상을 일으킴",
    "H319": "눈에 심각한 자극을 일으킴",
    "H320": "눈에 자극을 일으킴",
    "H330": "흡입하면 치명적임",
    "H331": "흡입하면 유독함",
    "H332": "흡입하면 유해함",
    "H333": "흡입하면 유해할 수 있음",
    "H334": "흡입 시 알레르기성 반응, 천식 또는 호흡 곤란을 일으킬 수 있음",
    "H335": "호흡기 자극을 일으킬 수 있음",
    "H336": "졸음 또는 현기증을 일으킬 수 있음",
    "H340": "유전적인 결함을 일으킬 수 있음",
    "H341": "유전적인 결함을 일으킬 것으로 의심됨",
    "H350": "암을 일으킬 수 있음",
    "H351": "암을 일으킬 것으로 의심됨",
    "H360": "태아 또는 생식능력에 손상을 일으킬 수 있음",
    "H361": "태아 또는 생식능력에 손상을 일으킬 것으로 의심됨",
    "H362": "모유를 먹는 아이에게 유해할 수 있음",
    "H370": "신체 장기에 손상을 일으킴",
    "H371": "신체 장기에 손상을 일으킬 수 있음",
    "H372": "장기간 또는 반복 노출되면 신체 장기에 손상을 일으킴",
    "H373": "장기간 또는 반복 노출되면 신체 장기에 손상을 일으킬 수 있음",

    // Environmental Hazards (H400–H441)
    "H400": "수생생물에 매우 유독함",
    "H401": "수생생물에 유독함",
    "H402": "수생생물에 유해함",
    "H410": "장기적인 영향에 의해 수생생물에 매우 유독함",
    "H411": "장기적인 영향에 의해 수생생물에 유독함",
    "H412": "장기적인 영향에 의해 수생생물에 유해함",
    "H413": "수생생물에게 장기적인 유해 영향을 일으킬 수 있음",
    "H420": "상층부 오존층을 파괴하여 공중 보건 및 환경에 유해함"
};

/**
 * Extracts H-Code from text and returns translated string if available.
 * Format usually: "H225: Highly flammable..." or just "H225"
 */
export const translateGHS = (text: string, lang: 'ko' | 'en'): string => {
    if (lang === 'en') return text;

    // Handle "Not Classified" and specific non-hazard statements
    if (text.toLowerCase().includes('not classified')) {
        return "GHS 유해성 기준에 해당하지 않음 (Not Classified)";
    }
    if (text.toLowerCase().includes('reported as not meeting ghs hazard criteria')) {
        return "GHS 유해성 기준을 충족하지 않는 것으로 보고됨";
    }

    // Extract H-Code (e.g., H225, H319)
    const match = text.match(/(H\d{3})/);
    if (match) {
        const code = match[1];
        const koreanDesc = GHS_KO[code];
        if (koreanDesc) {
            return `${code}: ${koreanDesc}`;
        }
    }

    return text;
};

export const GHS_PICTOGRAMS: Record<string, string> = {
    "GHS01": "https://pubchem.ncbi.nlm.nih.gov/images/ghs/GHS01.svg", // Exploding Bomb
    "GHS02": "https://pubchem.ncbi.nlm.nih.gov/images/ghs/GHS02.svg", // Flame
    "GHS03": "https://pubchem.ncbi.nlm.nih.gov/images/ghs/GHS03.svg", // Flame over Circle
    "GHS04": "https://pubchem.ncbi.nlm.nih.gov/images/ghs/GHS04.svg", // Gas Cylinder
    "GHS05": "https://pubchem.ncbi.nlm.nih.gov/images/ghs/GHS05.svg", // Corrosion
    "GHS06": "https://pubchem.ncbi.nlm.nih.gov/images/ghs/GHS06.svg", // Skull and Crossbones
    "GHS07": "https://pubchem.ncbi.nlm.nih.gov/images/ghs/GHS07.svg", // Exclamation Mark
    "GHS08": "https://pubchem.ncbi.nlm.nih.gov/images/ghs/GHS08.svg", // Health Hazard
    "GHS09": "https://pubchem.ncbi.nlm.nih.gov/images/ghs/GHS09.svg", // Environment
};

export const getPictogramUrl = (code: string): string | undefined => {
    // Input format: "GHS01" or "GHS01.gif" or full URL
    if (code.startsWith('http') || code.startsWith('data:image')) return code;

    const cleanCode = code.replace(/\.(gif|svg|png|jpg)$/i, '').trim();
    return GHS_PICTOGRAMS[cleanCode];
};
