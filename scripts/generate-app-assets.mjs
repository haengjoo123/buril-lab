import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const workspaceRoot = process.cwd()
const sourceIconPath = path.join(workspaceRoot, 'src', 'assets', 'burillab_app_icon.png')

async function ensureDirectory(targetPath) {
  await fs.mkdir(targetPath, { recursive: true })
}

async function writePngFromSource(sourcePath, outputPath, size) {
  await sharp(sourcePath)
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

async function writeAndroidLauncherAssets(sourcePath) {
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
    await writePngFromSource(sourcePath, path.join(densityDir, 'ic_launcher.png'), density.launcherSize)
    await writePngFromSource(sourcePath, path.join(densityDir, 'ic_launcher_round.png'), density.launcherSize)
    await writePngFromSource(sourcePath, path.join(densityDir, 'ic_launcher_foreground.png'), density.foregroundSize)
  }
}

async function main() {
  const publicDir = path.join(workspaceRoot, 'public')
  const resourcesDir = path.join(workspaceRoot, 'resources')

  await ensureDirectory(publicDir)
  await ensureDirectory(resourcesDir)

  console.log(`Using source icon: ${sourceIconPath}`)

  // Generate PWA assets
  await writePngFromSource(sourceIconPath, path.join(publicDir, 'pwa-192.png'), 192)
  await writePngFromSource(sourceIconPath, path.join(publicDir, 'pwa-512.png'), 512)
  await writePngFromSource(sourceIconPath, path.join(publicDir, 'pwa-maskable-512.png'), 512)
  
  // Replace vite.svg with pwa-icon as png (since user wants all icons replaced)
  // Note: we might want to keep the name if it's referenced, but the content should be the new logo.
  await writePngFromSource(sourceIconPath, path.join(publicDir, 'pwa-icon.png'), 512)
  
  // Capacitor resources
  await writePngFromSource(sourceIconPath, path.join(resourcesDir, 'icon.png'), 1024)
  // Splash usually has different aspect ratio, but we'll use the icon for now as a fallback or centered.
  await sharp(sourceIconPath)
    .resize(2732, 2732, { fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } }) // #0f172a
    .png()
    .toFile(path.join(resourcesDir, 'splash.png'))

  // Android Launcher
  await writeAndroidLauncherAssets(sourceIconIconPath)
}

const sourceIconIconPath = sourceIconPath; // simple alias for the script logic

main().catch((error) => {
  console.error('Failed to generate app assets.', error)
  process.exitCode = 1
})
