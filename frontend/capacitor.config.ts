import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.hartmonitor.app',
  appName: 'HartMonitor',
  webDir: 'dist',
  // In production, the app bundles the built web assets and calls the live API.
  // In development, point to your local backend with `npx cap run android --livereload`.
  server: {
    // Uncomment during local dev with live reload:
    // url: 'http://192.168.1.X:3001',
    // cleartext: true,
    androidScheme: 'https',
    iosScheme: 'https',
    hostname: 'app',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#030712', // gray-950 matches the app's dark theme
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#030712',
    },
    Preferences: {
      group: 'io.hartmonitor',
    },
  },
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false,
    scrollEnabled: false,
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false, // set true during dev
  },
};

export default config;
