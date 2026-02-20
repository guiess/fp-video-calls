import React, {useEffect} from 'react';
import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AuthProvider} from './src/contexts/AuthContext';
import {CallProvider} from './src/contexts/CallContext';
import AppNavigator from './src/navigation/AppNavigator';
import {setupCallKeep} from './src/services/notifications';

export default function App() {
  useEffect(() => {
    setupCallKeep().catch(e =>
      console.warn('[callkeep] setup failed', e),
    );
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#12121e" />
      <AuthProvider>
        <CallProvider>
          <AppNavigator />
        </CallProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
