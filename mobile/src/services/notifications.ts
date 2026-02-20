import messaging from '@react-native-firebase/messaging';
import {Platform} from 'react-native';
import RNCallKeep from 'react-native-callkeep';
import {updateFcmToken} from './firestore';

export async function setupCallKeep(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await RNCallKeep.setup({
    android: {
      alertTitle: 'Phone account permission',
      alertDescription:
        'FP Video Calls needs access to your phone accounts to display incoming calls.',
      cancelButton: 'Cancel',
      okButton: 'Grant',
      additionalPermissions: [],
      foregroundService: {
        channelId: 'com.fpvideocalls.calls',
        channelName: 'Ongoing call',
        notificationTitle: 'FP Video Calls — call in progress',
      },
    },
    ios: {appName: 'FP Video Calls'},
  });
  RNCallKeep.setAvailable(true);
}

export async function requestNotificationPermission(): Promise<boolean> {
  const status = await messaging().requestPermission();
  return (
    status === messaging.AuthorizationStatus.AUTHORIZED ||
    status === messaging.AuthorizationStatus.PROVISIONAL
  );
}

export async function registerFcmToken(uid: string): Promise<string | null> {
  try {
    const token = await messaging().getToken();
    if (token) {
      await updateFcmToken(uid, token);
    }
    messaging().onTokenRefresh(async newToken => {
      await updateFcmToken(uid, newToken);
    });
    return token;
  } catch (e) {
    console.warn('[fcm] token registration failed', e);
    return null;
  }
}
