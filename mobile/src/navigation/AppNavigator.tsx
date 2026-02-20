import React, {useRef} from 'react';
import {ActivityIndicator, View} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {useAuth} from '../contexts/AuthContext';
import {setCallNavigationRef} from '../contexts/CallContext';
import {RootStackParamList, MainTabParamList} from '../types';

import SignInScreen from '../screens/SignInScreen';
import HomeScreen from '../screens/HomeScreen';
import ContactsScreen from '../screens/ContactsScreen';
import RoomJoinScreen from '../screens/RoomJoinScreen';
import InCallScreen from '../screens/InCallScreen';
import OutgoingCallScreen from '../screens/OutgoingCallScreen';
import IncomingCallScreen from '../screens/IncomingCallScreen';
import GroupCallSetupScreen from '../screens/GroupCallSetupScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const NAV_THEME = {
  dark: true,
  colors: {
    primary: '#6c63ff',
    background: '#12121e',
    card: '#1a1a2e',
    text: '#ffffff',
    border: '#2a2a3e',
    notification: '#6c63ff',
  },
  fonts: {
    regular: {fontFamily: 'System', fontWeight: '400' as const},
    medium: {fontFamily: 'System', fontWeight: '500' as const},
    bold: {fontFamily: 'System', fontWeight: '700' as const},
    heavy: {fontFamily: 'System', fontWeight: '900' as const},
  },
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: {backgroundColor: '#1a1a2e'},
        headerTintColor: '#fff',
        tabBarStyle: {backgroundColor: '#1a1a2e', borderTopColor: '#2a2a3e'},
        tabBarActiveTintColor: '#6c63ff',
        tabBarInactiveTintColor: '#666',
      }}>
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{title: 'Home', tabBarLabel: 'Home'}}
      />
      <Tab.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{title: 'Contacts', tabBarLabel: 'Contacts'}}
      />
      <Tab.Screen
        name="Rooms"
        component={RoomJoinScreen}
        options={{title: 'Join Room', tabBarLabel: 'Room'}}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const {user, loading} = useAuth();
  const navRef = useRef<any>(null);

  if (loading) {
    return (
      <View
        style={{flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#12121e'}}>
        <ActivityIndicator size="large" color="#6c63ff" />
      </View>
    );
  }

  return (
    <NavigationContainer
      theme={NAV_THEME}
      ref={navRef}
      onReady={() => setCallNavigationRef(navRef)}>
      <Stack.Navigator screenOptions={{headerShown: false}}>
        {!user ? (
          <>
            <Stack.Screen name="SignIn" component={SignInScreen} />
            <Stack.Screen name="GuestRoomJoin" component={RoomJoinScreen} />
            <Stack.Screen
              name="InCall"
              component={InCallScreen}
              options={{presentation: 'fullScreenModal'}}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen
              name="InCall"
              component={InCallScreen}
              options={{presentation: 'fullScreenModal'}}
            />
            <Stack.Screen
              name="OutgoingCall"
              component={OutgoingCallScreen}
              options={{presentation: 'fullScreenModal'}}
            />
            <Stack.Screen
              name="IncomingCall"
              component={IncomingCallScreen}
              options={{presentation: 'fullScreenModal'}}
            />
            <Stack.Screen
              name="GroupCallSetup"
              component={GroupCallSetupScreen}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
