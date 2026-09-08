import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'tj.kakapo.store',
  appName: 'КАКАПО',
  webDir: 'www',
  // UI в APK. API — kakappo.shop
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
    cleartext: false,
    allowNavigation: [
      'https://kakappo.shop/*',
      'https://*.kakappo.shop/*',
    ],
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#030B05',
    appendUserAgent: ' KakapoStoreAndroid/1.0',
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 1800,
      backgroundColor: '#030B05',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#030B05',
      overlaysWebView: true,
    },
  },
}

export default config
