# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# WebRTC
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# Socket.IO
-keep class io.socket.** { *; }
-keep class com.github.nkzawa.** { *; }
-dontwarn io.socket.**

# Kotlin
-keep class kotlin.** { *; }
-keep class kotlin.Metadata { *; }
-dontwarn kotlin.**
-keepclassmembers class **$WhenMappings {
    <fields>;
}
-keepclassmembers class kotlin.Metadata {
    public <methods>;
}

# Compose
-keep class androidx.compose.** { *; }
-dontwarn androidx.compose.**