import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const workspaceRoot = process.cwd()
const sourceIconPath = path.join(workspaceRoot, 'public', 'pwa-icon.svg')

async function ensureDirectory(targetPath) {
  await fs.mkdir(targetPath, { recursive: true })
}

async function writePngFromSvg(svgBuffer, outputPath, size) {
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(outputPath)
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function writeAndroidLauncherAssets(svgBuffer) {
  const densities = [
    { folder: 'mipmap-mdpi', launcherSize: 48, foregroundSize: 108 },
    { folder: 'mipmap-hdpi', launcherSize: 72, foregroundSize: 162 },
    { folder: 'mipmap-xhdpi', launcherSize: 96, foregroundSize: 216 },
    { folder: 'mipmap-xxhdpi', launcherSize: 144, foregroundSize: 324 },
    { folder: 'mipmap-xxxhdpi', launcherSize: 192, foregroundSize: 432 },
  ]
  const androidResDir = path.join(workspaceRoot, 'android', 'app', 'src', 'main', 'res')

  if (!(await pathExists(androidResDir))) {
    return
  }

  for (const density of densities) {
    const densityDir = path.join(androidResDir, density.folder)
    await ensureDirectory(densityDir)
    await writePngFromSvg(svgBuffer, path.join(densityDir, 'ic_launcher.png'), density.launcherSize)
    await writePngFromSvg(svgBuffer, path.join(densityDir, 'ic_launcher_round.png'), density.launcherSize)
    await writePngFromSvg(svgBuffer, path.join(densityDir, 'ic_launcher_foreground.png'), density.foregroundSize)
  }
}

async function main() {
  const svgBuffer = await fs.readFile(sourceIconPath)
  const publicDir = path.join(workspaceRoot, 'public')
  const resourcesDir = path.join(workspaceRoot, 'resources')

  await ensureDirectory(publicDir)
  await ensureDirectory(resourcesDir)

  // 웹 PWA와 Android 런처가 동일한 브랜드 이미지를 보도록 공용 비트맵 자산을 생성합니다.
  await writePngFromSvg(svgBuffer, path.join(publicDir, 'pwa-192.png'), 192)
  await writePngFromSvg(svgBuffer, path.join(publicDir, 'pwa-512.png'), 512)
  await writePngFromSvg(svgBuffer, path.join(publicDir, 'pwa-maskable-512.png'), 512)
  await writePngFromSvg(svgBuffer, path.join(resourcesDir, 'icon.png'), 1024)
  await writePngFromSvg(svgBuffer, path.join(resourcesDir, 'splash.png'), 2732)
  await writeAndroidLauncherAssets(svgBuffer)
}

main().catch((error) => {
  console.error('Failed to generate app assets.', error)
  process.exitCode = 1
})
