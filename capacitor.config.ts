import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.burillab.app',
  appName: 'Buril Lab',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: {
    hostname: 'app.buril-lab.local',
    androidScheme: 'https',
    appStartPath: '/app',
  },
}

export default config
