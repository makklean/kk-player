import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.makklean.kkplayer',
  appName: 'KK Player',
  webDir: 'www',
  bundledWebRuntime: false,
  plugins: {
    SystemBars: { insetsHandling: 'css', style: 'DARK', hidden: false },
    SplashScreen: { launchShowDuration: 1200, launchAutoHide: true, launchFadeOutDuration: 250, backgroundColor: '#080b12', showSpinner: false },
  },
};

export default config;
