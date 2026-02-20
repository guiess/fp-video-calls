import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useAuth} from '../contexts/AuthContext';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList} from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

export default function SignInScreen({navigation}: Props) {
  const {signInWithGoogle, loading} = useAuth();
  const [signing, setSigning] = React.useState(false);
  const [error, setError] = React.useState('');

  const handleSignIn = async () => {
    setSigning(true);
    setError('');
    try {
      await signInWithGoogle();
      // AppNavigator will redirect to Main automatically via auth state
    } catch (e: any) {
      setError(e?.message ?? 'Sign-in failed. Please try again.');
    } finally {
      setSigning(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>📹</Text>
      <Text style={styles.title}>FP Video Calls</Text>
      <Text style={styles.subtitle}>Call family & friends</Text>

      <TouchableOpacity
        style={styles.googleBtn}
        onPress={handleSignIn}
        disabled={signing || loading}>
        {signing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.googleBtnText}>🔵  Sign in with Google</Text>
        )}
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={styles.guestBtn}
        onPress={() => navigation.navigate('GuestRoomJoin')}>
        <Text style={styles.guestBtnText}>Continue as Guest</Text>
      </TouchableOpacity>

      <Text style={styles.guestNote}>
        Guest mode: join any room by name — no account needed.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#12121e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  logo: {fontSize: 72, marginBottom: 16},
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#aaa',
    marginBottom: 48,
  },
  googleBtn: {
    backgroundColor: '#6c63ff',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
  },
  googleBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  error: {
    color: '#ff6b6b',
    marginBottom: 16,
    textAlign: 'center',
  },
  guestBtn: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 12,
    marginTop: 8,
  },
  guestBtnText: {color: '#aaa', fontSize: 15},
  guestNote: {
    color: '#555',
    fontSize: 12,
    marginTop: 16,
    textAlign: 'center',
  },
});
