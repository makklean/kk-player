import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.makklean.kkplayer',
  appName: 'KK Player',
  webDir: 'www',
  bundledWebRuntime: false,
  plugins: {
    SystemBars: { insetsHandling: 'css', style: 'DARK', hidden: false },
    SplashScreen: { launchShowDuration: 1800, launchAutoHide: true, launchFadeOutDuration: 350, backgroundColor: '#080b12', showSpinner: false },
  },
};

export default config;
