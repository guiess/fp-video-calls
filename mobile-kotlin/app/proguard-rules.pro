# WebRTC
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# Socket.IO
-keep class io.socket.** { *; }
-dontwarn io.socket.**
-keep class io.engineio.** { *; }
-dontwarn io.engineio.**

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Firebase
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**
