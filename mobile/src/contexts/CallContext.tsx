import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import messaging from '@react-native-firebase/messaging';
import RNCallKeep from 'react-native-callkeep';
import {CallType, IncomingCallData} from '../types';

type CallContextValue = {
  incomingCall: IncomingCallData | null;
  clearIncomingCall: () => void;
};

const CallContext = createContext<CallContextValue>({
  incomingCall: null,
  clearIncomingCall: () => {},
});

// Navigation ref must be set externally (see AppNavigator.tsx)
export let callNavigationRef: React.MutableRefObject<any> | null = null;
export function setCallNavigationRef(ref: React.MutableRefObject<any>) {
  callNavigationRef = ref;
}

export const CallProvider: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(
    null,
  );
  // Map callUUID → IncomingCallData so the background handler and foreground
  // handler share the same data store.
  const pendingCalls = useRef<Map<string, IncomingCallData>>(new Map());

  const showIncomingCall = useCallback((data: Record<string, string>) => {
    const callData: IncomingCallData = {
      callUUID: data.callUUID,
      roomId: data.roomId,
      callerId: data.callerId,
      callerName: data.callerName ?? 'Unknown',
      callerPhoto: data.callerPhoto,
      callType: (data.callType as CallType) ?? 'direct',
    };
    pendingCalls.current.set(data.callUUID, callData);
    setIncomingCall(callData);
    RNCallKeep.displayIncomingCall(
      data.callUUID,
      'FP Video Calls',
      callData.callerName,
      'generic',
      true,
    );
    callNavigationRef?.current?.navigate('IncomingCall', {callData});
  }, []);

  const clearIncomingCall = useCallback(() => {
    setIncomingCall(null);
  }, []);

  useEffect(() => {
    // Foreground FCM handler
    const unsubForeground = messaging().onMessage(async remoteMessage => {
      const data = remoteMessage.data as Record<string, string> | undefined;
      if (!data) return;
      if (data.type === 'call_invite') {
        showIncomingCall(data);
      }
      if (data.type === 'call_cancel') {
        const pending = pendingCalls.current.get(data.callUUID);
        if (pending) {
          pendingCalls.current.delete(data.callUUID);
          setIncomingCall(null);
          RNCallKeep.endCall(data.callUUID);
          callNavigationRef?.current?.goBack();
        }
      }
    });

    // App opened from a background FCM notification tap
    const unsubOpened = messaging().onNotificationOpenedApp(remoteMessage => {
      const data = remoteMessage.data as Record<string, string> | undefined;
      if (data?.type === 'call_invite') {
        const stored = pendingCalls.current.get(data.callUUID);
        if (stored) {
          callNavigationRef?.current?.navigate('IncomingCall', {
            callData: stored,
          });
        }
      }
    });

    // CallKeep: user answered from system UI (app was killed / background)
    RNCallKeep.addEventListener('answerCall', ({callUUID}) => {
      const stored = pendingCalls.current.get(callUUID);
      if (stored) {
        pendingCalls.current.delete(callUUID);
        setIncomingCall(null);
        callNavigationRef?.current?.navigate('InCall', {
          roomId: stored.roomId,
          displayName: stored.callerName,
          userId: stored.callerId,
          callType: stored.callType,
        });
      }
    });

    RNCallKeep.addEventListener('endCall', ({callUUID}) => {
      pendingCalls.current.delete(callUUID);
      setIncomingCall(null);
    });

    return () => {
      unsubForeground();
      unsubOpened();
      RNCallKeep.removeEventListener('answerCall');
      RNCallKeep.removeEventListener('endCall');
    };
  }, [showIncomingCall]);

  return (
    <CallContext.Provider value={{incomingCall, clearIncomingCall}}>
      {children}
    </CallContext.Provider>
  );
};

export const useCall = () => useContext(CallContext);
