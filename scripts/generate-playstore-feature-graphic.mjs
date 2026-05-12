import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const workspaceRoot = process.cwd()
const resourcesDir = path.join(workspaceRoot, 'resources')
const outputSvgPath = path.join(resourcesDir, 'play-store-feature-graphic.svg')
const outputPngPath = path.join(resourcesDir, 'play-store-feature-graphic.png')
const iconPath = path.join(workspaceRoot, 'src', 'assets', 'burillab_app_icon.png')
const fontPath = path.join(workspaceRoot, 'public', 'fonts', 'NotoSansKR-Medium.ttf')

const WIDTH = 1024
const HEIGHT = 500

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function chip(x, y, label, accent, width) {
  return `
    <g transform="translate(${x} ${y})">
      <rect width="${width}" height="38" rx="19" fill="#ffffff" opacity="0.92"/>
      <circle cx="22" cy="19" r="7" fill="${accent}"/>
      <text x="40" y="24" class="chip-text">${escapeHtml(label)}</text>
    </g>
  `
}

function miniBottle(x, y, color, label) {
  return `
    <g transform="translate(${x} ${y})">
      <rect x="14" y="0" width="22" height="15" rx="5" fill="#e2e8f0"/>
      <rect x="9" y="13" width="32" height="70" rx="10" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/>
      <rect x="12" y="44" width="26" height="34" rx="8" fill="${color}" opacity="0.92"/>
      <text x="25" y="65" text-anchor="middle" class="bottle-label">${escapeHtml(label)}</text>
    </g>
  `
}

function svg({ iconDataUri, fontDataUri }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <style>
      @font-face {
        font-family: 'Noto Sans KR Local';
        src: url('${fontDataUri}') format('truetype');
      }

      .font { font-family: 'Noto Sans KR Local', 'Noto Sans KR', Arial, sans-serif; }
      .brand { font-family: 'Noto Sans KR Local', 'Noto Sans KR', Arial, sans-serif; font-size: 44px; font-weight: 700; fill: #0f172a; }
      .headline { font-family: 'Noto Sans KR Local', 'Noto Sans KR', Arial, sans-serif; font-size: 41px; font-weight: 700; fill: #0f172a; }
      .headline-small { font-family: 'Noto Sans KR Local', 'Noto Sans KR', Arial, sans-serif; font-size: 36px; font-weight: 700; fill: #0f172a; }
      .subcopy { font-family: 'Noto Sans KR Local', 'Noto Sans KR', Arial, sans-serif; font-size: 20px; fill: #334155; }
      .chip-text { font-family: 'Noto Sans KR Local', 'Noto Sans KR', Arial, sans-serif; font-size: 16px; font-weight: 700; fill: #1e293b; }
      .phone-title { font-family: 'Noto Sans KR Local', 'Noto Sans KR', Arial, sans-serif; font-size: 21px; font-weight: 700; fill: #f8fafc; }
      .phone-muted { font-family: 'Noto Sans KR Local', 'Noto Sans KR', Arial, sans-serif; font-size: 12px; fill: #94a3b8; }
      .phone-body { font-family: 'Noto Sans KR Local', 'Noto Sans KR', Arial, sans-serif; font-size: 14px; fill: #334155; }
      .phone-strong { font-family: 'Noto Sans KR Local', 'Noto Sans KR', Arial, sans-serif; font-size: 19px; font-weight: 700; fill: #0f172a; }
      .phone-label { font-family: 'Noto Sans KR Local', 'Noto Sans KR', Arial, sans-serif; font-size: 12px; font-weight: 700; fill: #475569; }
      .bottle-label { font-family: 'Noto Sans KR Local', 'Noto Sans KR', Arial, sans-serif; font-size: 13px; font-weight: 700; fill: #ffffff; }
    </style>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="51%" stop-color="#e0f2fe"/>
      <stop offset="100%" stop-color="#ecfdf5"/>
    </linearGradient>
    <linearGradient id="phoneEdge" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="screenTop" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#172554"/>
      <stop offset="100%" stop-color="#0f766e"/>
    </linearGradient>
    <linearGradient id="card" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f8fafc"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="20" stdDeviation="18" flood-color="#0f172a" flood-opacity="0.18"/>
    </filter>
    <filter id="lightShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.12"/>
    </filter>
    <clipPath id="phoneClip">
      <rect x="646" y="41" width="300" height="418" rx="36"/>
    </clipPath>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <path d="M-40 430 C150 355 204 432 365 345 C502 270 586 192 740 215 C850 231 942 186 1084 83 L1084 560 L-40 560 Z" fill="#0f766e" opacity="0.09"/>
  <path d="M-20 86 C115 49 204 70 318 125 C447 187 568 105 714 63 C844 26 943 57 1064 124" fill="none" stroke="#2563eb" stroke-width="26" opacity="0.08"/>

  <g opacity="0.14" transform="translate(493 62)">
    <rect x="0" y="0" width="72" height="72" transform="rotate(45 36 36)" fill="#ef4444"/>
    <rect x="178" y="284" width="62" height="62" transform="rotate(45 209 315)" fill="#facc15"/>
    <rect x="405" y="25" width="56" height="56" transform="rotate(45 433 53)" fill="#1d4ed8"/>
  </g>

  <g transform="translate(67 64)" filter="url(#lightShadow)">
    <rect x="0" y="0" width="86" height="86" rx="24" fill="#ffffff"/>
    <image href="${iconDataUri}" x="10" y="10" width="66" height="66"/>
  </g>
  <text x="170" y="108" class="brand">Buril Lab</text>
  <text x="68" y="193" class="headline">실험실 시약·폐액 관리</text>
  <text x="68" y="239" class="headline-small">더 빠르고 안전하게</text>
  <text x="70" y="282" class="subcopy">검색, 스캔, 분류, 시약장·재고 기록까지 한 번에</text>

  ${chip(70, 323, '시약 검색', '#2563eb', 132)}
  ${chip(218, 323, '폐기 분류', '#ef4444', 132)}
  ${chip(366, 323, '시약장 배치', '#0f766e', 150)}
  ${chip(70, 376, '재고 기록', '#facc15', 132)}

  <g transform="translate(282 393)" opacity="0.95">
    <rect x="0" y="38" width="235" height="12" rx="6" fill="#64748b" opacity="0.2"/>
    <rect x="10" y="0" width="214" height="48" rx="13" fill="#ffffff" filter="url(#lightShadow)"/>
    <path d="M29 31 L48 13 L67 31" fill="none" stroke="#0f766e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M95 30 L115 14 L135 30" fill="none" stroke="#2563eb" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M161 30 L181 14 L201 30" fill="none" stroke="#ef4444" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  <g transform="translate(565 84)" opacity="0.92">
    <rect x="0" y="257" width="170" height="10" rx="5" fill="#64748b" opacity="0.18"/>
    <rect x="18" y="31" width="118" height="226" rx="14" fill="#ffffff" filter="url(#lightShadow)"/>
    <rect x="30" y="53" width="94" height="15" rx="7" fill="#e2e8f0"/>
    <rect x="30" y="83" width="94" height="15" rx="7" fill="#e2e8f0"/>
    <rect x="30" y="113" width="94" height="15" rx="7" fill="#e2e8f0"/>
    <rect x="30" y="143" width="94" height="15" rx="7" fill="#e2e8f0"/>
    <rect x="49" y="0" width="58" height="47" rx="12" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/>
    <rect x="57" y="12" width="42" height="27" rx="8" fill="#0f766e" opacity="0.86"/>
    ${miniBottle(62, 68, '#2563eb', 'A')}
    ${miniBottle(16, 146, '#ef4444', 'B')}
    ${miniBottle(104, 146, '#facc15', 'C')}
  </g>

  <g filter="url(#softShadow)">
    <rect x="625" y="20" width="342" height="460" rx="52" fill="url(#phoneEdge)"/>
    <rect x="646" y="41" width="300" height="418" rx="36" fill="#f8fafc"/>
  </g>
  <g clip-path="url(#phoneClip)">
    <rect x="646" y="41" width="300" height="418" fill="#f8fafc"/>
    <rect x="646" y="41" width="300" height="116" fill="url(#screenTop)"/>
    <image href="${iconDataUri}" x="670" y="65" width="40" height="40"/>
    <text x="721" y="86" class="phone-title">Buril Lab</text>
    <text x="721" y="108" class="phone-muted">실험실 폐시약 안전관리</text>
    <rect x="672" y="127" width="247" height="48" rx="18" fill="#ffffff" opacity="0.96"/>
    <circle cx="696" cy="151" r="8" fill="none" stroke="#2563eb" stroke-width="3"/>
    <line x1="702" y1="157" x2="710" y2="165" stroke="#2563eb" stroke-width="3" stroke-linecap="round"/>
    <text x="724" y="157" class="phone-body">Acetone · 67-64-1</text>

    <rect x="672" y="193" width="247" height="111" rx="18" fill="url(#card)" stroke="#e2e8f0"/>
    <rect x="690" y="211" width="44" height="44" rx="14" fill="#fee2e2"/>
    <rect x="703" y="219" width="18" height="18" transform="rotate(45 712 228)" fill="#ef4444"/>
    <text x="752" y="228" class="phone-label">자동 폐기 분류</text>
    <text x="752" y="254" class="phone-strong">비할로겐 유기 폐액</text>
    <text x="692" y="286" class="phone-body">MSDS 확인 후 전용 용기에 기록</text>

    <rect x="672" y="322" width="118" height="88" rx="18" fill="#ecfeff" stroke="#bae6fd"/>
    <text x="692" y="349" class="phone-label">시약장</text>
    <rect x="692" y="361" width="76" height="9" rx="4" fill="#0f766e"/>
    <rect x="692" y="379" width="52" height="9" rx="4" fill="#2dd4bf"/>
    <circle cx="772" cy="383" r="12" fill="#0f766e"/>

    <rect x="801" y="322" width="118" height="88" rx="18" fill="#fff7ed" stroke="#fed7aa"/>
    <text x="821" y="349" class="phone-label">재고</text>
    <rect x="821" y="363" width="52" height="9" rx="4" fill="#f97316"/>
    <rect x="821" y="381" width="76" height="9" rx="4" fill="#fdba74"/>
    <circle cx="891" cy="360" r="12" fill="#facc15"/>

    <rect x="646" y="422" width="300" height="37" fill="#ffffff"/>
    <circle cx="696" cy="440" r="5" fill="#2563eb"/>
    <circle cx="763" cy="440" r="5" fill="#94a3b8"/>
    <circle cx="830" cy="440" r="5" fill="#94a3b8"/>
    <circle cx="897" cy="440" r="5" fill="#94a3b8"/>
  </g>
  <rect x="748" y="32" width="96" height="7" rx="3.5" fill="#020617" opacity="0.55"/>
</svg>
`
}

async function main() {
  await fs.mkdir(resourcesDir, { recursive: true })

  const [iconBuffer, fontBuffer] = await Promise.all([
    fs.readFile(iconPath),
    fs.readFile(fontPath),
  ])
  const iconDataUri = `data:image/png;base64,${iconBuffer.toString('base64')}`
  const fontDataUri = `data:font/truetype;base64,${fontBuffer.toString('base64')}`
  const svgSource = svg({ iconDataUri, fontDataUri })

  await fs.writeFile(outputSvgPath, svgSource, 'utf8')
  await sharp(Buffer.from(svgSource))
    .resize(WIDTH, HEIGHT, { fit: 'fill' })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9 })
    .toFile(outputPngPath)

  const metadata = await sharp(outputPngPath).metadata()
  console.log(`Generated ${path.relative(workspaceRoot, outputPngPath)} (${metadata.width}x${metadata.height})`)
  console.log(`Source ${path.relative(workspaceRoot, outputSvgPath)}`)
}

main().catch((error) => {
  console.error('Failed to generate Play Store feature graphic.', error)
  process.exitCode = 1
})
