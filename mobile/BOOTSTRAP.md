# FP Video Calls — Mobile App (Android)

React Native Android app with Google Sign-In, direct calls, group calls, and push notifications via FCM.

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 18 |
| JDK | 17 |
| Android Studio | Hedgehog or newer |
| Android SDK | API 34 |
| React Native CLI | latest |

---

## Step 1 — Firebase project setup

1. Go to [Firebase Console](https://console.firebase.google.com) → **Add project**
2. Enable **Authentication** → Sign-in providers → **Google**
3. Enable **Firestore Database** (start in production mode, deploy rules below)
4. Enable **Cloud Messaging** (FCM)
5. Add an **Android app** with package name `com.fpvideocalls`
6. Get the **SHA-1** of your debug keystore:
   ```
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
   ```
   Paste the SHA-1 into the Firebase Android app settings.
7. Download `google-services.json` → place it at `mobile/android/app/google-services.json`
8. Copy the **Web client ID** (from Auth → Google provider → Web SDK configuration) into `src/config.ts` → `GOOGLE_WEB_CLIENT_ID`
9. Copy your **signaling server URL** into `src/config.ts` → `SIGNALING_URL`

### Deploy Firestore rules

```bash
npm install -g firebase-tools
firebase login
firebase init firestore   # select your project, use existing firestore.rules
firebase deploy --only firestore:rules
```

---

## Step 2 — Scaffold the native Android shell

Run this **once** from the repo root:

```bash
npx react-native@latest init FpVideoCalls --directory mobile --template react-native-template-typescript --skip-install
```

This generates the `mobile/android/` native project.  All source files in `mobile/src/` are already written — do **not** overwrite them.

Then install dependencies:

```bash
cd mobile
npm install
```

---

## Step 3 — Android native configuration

### 3a. google-services plugin

In `mobile/android/build.gradle` (project-level), add inside `dependencies {}`:
```groovy
classpath 'com.google.gms:google-services:4.4.0'
```

In `mobile/android/app/build.gradle` (app-level), add at the **bottom**:
```groovy
apply plugin: 'com.google.gms.google-services'
```

### 3b. react-native-webrtc permissions

In `mobile/android/app/src/main/AndroidManifest.xml`, inside `<manifest>`:
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />
<uses-permission android:name="android.permission.INTERNET" />
```

### 3c. react-native-callkeep (ConnectionService)

In `mobile/android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.BIND_TELECOM_CONNECTION_SERVICE" />
<uses-permission android:name="android.permission.CALL_PHONE" />
<uses-permission android:name="android.permission.MANAGE_OWN_CALLS" />

<!-- inside <application> -->
<service
  android:name="io.wazo.callkeep.VoiceConnectionService"
  android:label="Calls"
  android:permission="android.permission.BIND_TELECOM_CONNECTION_SERVICE">
  <intent-filter>
    <action android:name="android.telecom.ConnectionService" />
  </intent-filter>
</service>
```

### 3d. FCM high-priority (for background calls)

In `mobile/android/app/src/main/AndroidManifest.xml`, inside `<application>`:
```xml
<service
  android:name="com.google.firebase.messaging.FirebaseMessagingService"
  android:exported="false">
  <intent-filter android:priority="-500">
    <action android:name="com.google.firebase.MESSAGING_EVENT" />
  </intent-filter>
</service>
```

### 3e. Minimum SDK

In `mobile/android/app/build.gradle`, ensure:
```groovy
android {
  defaultConfig {
    minSdkVersion 26   // required by react-native-callkeep
    targetSdkVersion 34
  }
}
```

---

## Step 4 — Server: Firebase Admin SDK

The signaling server now requires `firebase-admin` for call invites.

```bash
cd server
npm install
```

Add your Firebase service account credentials as an environment variable:

```bash
# Encode the service account JSON file
base64 -w 0 path/to/serviceAccountKey.json

# Add to .env or server environment:
FIREBASE_SERVICE_ACCOUNT_JSON=<base64 output>
```

---

## Step 5 — Run

```bash
# Terminal 1 — Metro bundler
cd mobile && npm start

# Terminal 2 — Android build
cd mobile && npm run android

# Terminal 3 — Signaling server
cd server && npm start
```

---

## Architecture recap

```
FCM (call invite) ─────────────────► Callee device rings (CallKeep)
Caller app ──► POST /api/call/invite   │
               (server fetches callee  │  User answers
                FCM token, sends push) │       │
                                       └───────┴──► both join Socket.IO room
                                                     WebRTC negotiation begins
```

- Contacts and user profiles live in **Firestore** only — server remains stateless
- `react-native-callkeep` uses Android `ConnectionService` for a native system-level call screen
- `react-native-incall-manager` handles speakerphone, ringtone, and earpiece routing
- Guest mode works without any login — same as the web app
