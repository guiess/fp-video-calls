# Video Conference - Android App

This is the Android application for the Video Conference platform. It provides the same functionality as the web client, with an additional debug log page for troubleshooting.

## Features

- ✅ **Video Conferencing**: Real-time audio and video communication using WebRTC
- ✅ **Room Management**: Create and join rooms with optional password protection
- ✅ **Participant View**: See all participants with their video streams
- ✅ **Audio/Video Controls**: Mute/unmute microphone and enable/disable camera
- ✅ **Multi-language Support**: English and Russian languages
- ✅ **Debug Logs Page**: In-memory circular buffer for debug/trace information (max 500 entries)
- ✅ **Responsive Design**: Adapts to different screen sizes and orientations

## Technical Stack

- **Language**: Kotlin
- **UI Framework**: Jetpack Compose
- **WebRTC**: Google WebRTC library
- **Signaling**: Socket.IO client
- **Architecture**: MVVM with Compose state management
- **Min SDK**: 24 (Android 7.0)
- **Target SDK**: 34 (Android 14)

## Project Structure

```
android/
├── app/
│   ├── src/main/
│   │   ├── java/com/videoconf/
│   │   │   ├── MainActivity.kt                 # Main entry point
│   │   │   ├── ui/
│   │   │   │   ├── screens/
│   │   │   │   │   ├── MainScreen.kt          # Main conference screen
│   │   │   │   │   └── LogScreen.kt           # Debug logs screen
│   │   │   │   └── theme/                      # App theme and styling
│   │   │   ├── webrtc/
│   │   │   │   └── WebRTCService.kt           # WebRTC implementation
│   │   │   └── utils/
│   │   │       └── Logger.kt                  # In-memory logger
│   │   ├── res/                                # Resources
│   │   └── AndroidManifest.xml
│   ├── build.gradle                            # App build configuration
│   └── proguard-rules.pro
├── build.gradle                                # Project build configuration
├── settings.gradle
└── README.md
```

## Key Components

### Logger (In-Memory Circular Buffer)

The [`Logger.kt`](app/src/main/java/com/videoconf/utils/Logger.kt) provides a memory-safe logging system:

- **Circular Buffer**: Automatically removes oldest entries when limit (500) is reached
- **Non-Persistent**: Logs are kept only in memory, cleared on app restart
- **Thread-Safe**: Uses `ConcurrentLinkedQueue` for concurrent access
- **Log Levels**: DEBUG, INFO, WARN, ERROR
- **Auto-Refresh**: Log screen updates every second

### WebRTC Service

The [`WebRTCService.kt`](app/src/main/java/com/videoconf/webrtc/WebRTCService.kt) handles:

- Peer connection management
- Local media stream capture (camera/microphone)
- Signaling via Socket.IO
- ICE candidate exchange
- Offer/Answer negotiation

### Main Screen

The [`MainScreen.kt`](app/src/main/java/com/videoconf/ui/screens/MainScreen.kt) provides:

- Pre-join lobby with room selection
- In-room video grid with local and remote participants
- Control buttons for mic, camera, and leaving
- Participant list with mic state indicators

### Log Screen

The [`LogScreen.kt`](app/src/main/java/com/videoconf/ui/screens/LogScreen.kt) displays:

- Real-time debug logs
- Color-coded log levels
- Entry count indicator
- Clear logs functionality
- Auto-scroll to latest entry

## Setup and Build

### Prerequisites

- Android Studio Hedgehog (2023.1.1) or later
- JDK 17
- Android SDK 34
- Gradle 8.1+

### Configuration

1. **Server URL**: Copy [`local.properties.example`](local.properties.example) to `local.properties` and configure:

```properties
# For Android emulator connecting to localhost
signaling.url=http://10.0.2.2:3000

# For real device on same network (replace with your computer's IP)
# signaling.url=http://192.168.1.100:3000

# For production server
# signaling.url=https://your-server.com
```

The `local.properties` file is ignored by git, so your local configuration won't be committed.

**Default value**: If `local.properties` doesn't exist, it defaults to `http://10.0.2.2:3000` (Android emulator localhost).

### Building

1. **Configure server URL**:
   ```bash
   cp local.properties.example local.properties
   # Edit local.properties with your server URL
   ```

2. Open the project in Android Studio

3. Sync Gradle files

4. Build the project: `Build > Make Project`

5. Run on device/emulator: `Run > Run 'app'`

Or via command line:

```bash
cd android
cp local.properties.example local.properties
# Edit local.properties if needed
./gradlew assembleDebug
```

The APK will be generated at: `app/build/outputs/apk/debug/app-debug.apk`

## Permissions

The app requires the following permissions:

- `INTERNET`: Network communication
- `ACCESS_NETWORK_STATE`: Check network connectivity
- `CAMERA`: Video capture
- `RECORD_AUDIO`: Audio capture
- `MODIFY_AUDIO_SETTINGS`: Audio routing control
- `WAKE_LOCK`: Keep screen on during calls

## Usage

### Joining a Room

1. Enter your username
2. Enter the room ID (or leave empty to create a new room)
3. Optional: Enter room password if required
4. Tap "Join Room"

### During a Call

- **Microphone**: Tap mic button to mute/unmute
- **Camera**: Tap camera button to enable/disable video
- **Leave**: Tap leave button to exit the room
- **Logs**: Access debug logs from the top bar
- **Settings**: Configure language and other options

### Debug Logs

- Access via the bug icon in the top bar
- View real-time logs with color-coded levels
- Clear logs with the trash icon
- Auto-scrolls to latest entry
- Shows entry count (max 500)

## Differences from Web Client

### Replaced Features

- **Dev Page** → **Log Page**: Instead of a dev/debug page, the Android app includes an in-memory log viewer for troubleshooting without needing external tools.

### Similarities

- Same room management functionality
- Same WebRTC implementation approach
- Same audio/video controls
- Same multi-language support (English/Russian)
- Same password-protected rooms feature

## Troubleshooting

### Camera/Microphone Not Working

1. Check app permissions in device settings
2. Close other apps using camera/microphone
3. Check logs for permission errors

### Connection Issues

1. Verify server URL in `local.properties` is correct
2. Check network connectivity
3. Review logs for socket connection errors (access via bug icon in app)
4. For emulator: use `10.0.2.2` instead of `localhost`
5. For real device: use your computer's IP address (e.g., `192.168.1.100`)

### Build Errors

1. Sync Gradle files: `File > Sync Project with Gradle Files`
2. Invalidate caches: `File > Invalidate Caches and Restart`
3. Clean and rebuild: `Build > Clean Project` then `Build > Rebuild Project`

## Development Notes

### Adding New Features

1. Update [`WebRTCService.kt`](app/src/main/java/com/videoconf/webrtc/WebRTCService.kt) for WebRTC functionality
2. Update [`MainScreen.kt`](app/src/main/java/com/videoconf/ui/screens/MainScreen.kt) for UI changes
3. Add logging with [`Logger`](app/src/main/java/com/videoconf/utils/Logger.kt) for debugging

### Testing

- Test on real devices for best results (emulator may have camera limitations)
- Test with multiple participants
- Test network conditions (WiFi, mobile data)
- Monitor logs for errors

## License

Same as the main project.

## Related

- [Web Client](../web/)
- [Signaling Server](../server/)
- [TURN Server Setup](../turn/)