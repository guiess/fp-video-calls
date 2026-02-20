const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

const defaultConfig = getDefaultConfig(__dirname);

// react-native-webrtc requires specific resolver settings
const config = {
  resolver: {
    sourceExts: [...defaultConfig.resolver.sourceExts, 'cjs'],
    blockList: [
      // Exclude android native build artifacts to prevent Metro watcher crashes
      /node_modules\/.*\/android\/.*/,
      /android\/.*/,
    ],
  },
};

module.exports = mergeConfig(defaultConfig, config);
