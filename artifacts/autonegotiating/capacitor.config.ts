import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.autonegotiating.app',
  appName: 'AutoNegotiating',
  // Vite builds to dist/public — Capacitor copies these files into the native projects
  webDir: 'dist/public',
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#FAFAF7',
      showSpinner: false,
    },
  },
  // Uncomment and set this to your production API origin when doing live-reload dev:
  // server: {
  //   url: 'http://YOUR_LOCAL_IP:3000',
  //   cleartext: true,
  // },
};

export default config;
