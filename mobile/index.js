/**
 * Entry point for FP Video Calls React Native app.
 *
 * The FCM background handler here runs in a headless JS context when the
 * app is killed or backgrounded.  It uses react-native-callkeep to display
 * the system-level incoming call UI (same as WhatsApp / Telegram).
 */
// Polyfill crypto.getRandomValues for uuid on React Native (must be first import)
import 'react-native-get-random-values';
import {AppRegistry} from 'react-native';
import messaging from '@react-native-firebase/messaging';
import RNCallKeep from 'react-native-callkeep';
import App from './App';

// Background FCM handler — runs even when the app is killed
messaging().setBackgroundMessageHandler(async remoteMessage => {
  const data = remoteMessage.data;
  if (!data) return;

  if (data.type === 'call_invite') {
    // Show system call screen via ConnectionService
    RNCallKeep.displayIncomingCall(
      data.callUUID,
      'FP Video Calls',
      data.callerName ?? 'Unknown',
      'generic',
      true, // hasVideo
    );
  }

  if (data.type === 'call_cancel') {
    RNCallKeep.endCall(data.callUUID);
  }
});

AppRegistry.registerComponent('FpVideoCalls', () => App);
