import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ratiod.portalprobe',
  appName: "Ratio'd",
  webDir: 'out',
  server: {
    androidScheme: 'https'
  }
};

export default config;
