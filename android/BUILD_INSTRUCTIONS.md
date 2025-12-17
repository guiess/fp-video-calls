# Android App Build Instructions

## Quick Build

### Option 1: Android Studio (Recommended)
1. Open Android Studio
2. File → Open → Select `android` folder
3. Wait for Gradle sync
4. Build → Make Project
5. Run → Run 'app'

### Option 2: Command Line
```bash
cd android
./gradlew assembleDebug --max-workers=2 -Dorg.gradle.jvmargs="-Xmx2048m"
```

The APK will be at: `app/build/outputs/apk/debug/app-debug.apk`

## Configuration

### Server URL Setup
1. Copy the example: `cp local.properties.example local.properties`
2. Edit `local.properties`:
   ```properties
   # For Android emulator
   signaling.url=http://10.0.2.2:3000
   
   # For real device (replace with your IP)
   # signaling.url=http://192.168.1.100:3000
   ```

## Troubleshooting

### Build Fails with Memory Error
Add to `gradle.properties`:
```properties
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=512m
org.gradle.daemon=false
```

### Gradle Daemon Issues
```bash
./gradlew --stop
./gradlew assembleDebug --no-daemon
```

### Clean Build
```bash
./gradlew clean
./gradlew assembleDebug
```

## Requirements
- JDK 17 or 21
- Android SDK 34
- Gradle 9.0
- Android Studio Hedgehog or later (if using IDE)