import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'tj.kakapo.trade',
  appName: 'КАКАПО ТОРГОВЛЯ',
  webDir: 'www',
  // Trade UI с сервера — без дублирования Next-сборки в APK
  server: {
    url: 'https://kakappo.shop/trade',
    cleartext: false,
    allowNavigation: [
      'https://kakappo.shop/*',
      'https://*.kakappo.shop/*',
    ],
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#070C09',
    appendUserAgent: ' KakapoTradeAndroid/1.0',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 400,
      backgroundColor: '#070C09',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#070C09',
      overlaysWebView: true,
    },
  },
}

export default config
