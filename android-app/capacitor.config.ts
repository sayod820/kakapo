import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'tj.kakapo.trade',
  appName: 'КАКАПО ТОРГОВЛЯ',
  webDir: 'www',
  // UI лежит в APK. API — kakappo.shop (очередь при отсутствии сети).
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
    backgroundColor: '#F3F7F4',
    appendUserAgent: ' KakapoTradeAndroid/1.0',
  },
  plugins: {
    CapacitorHttp: {
      // native HTTP — без CORS WebView, иначе prefetch фото в APK молча падает
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#F3F7F4',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#F3F7F4',
      overlaysWebView: true,
    },
  },
}

export default config
