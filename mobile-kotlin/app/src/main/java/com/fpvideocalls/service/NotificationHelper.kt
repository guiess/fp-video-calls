package com.fpvideocalls.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.fpvideocalls.MainActivity
import com.fpvideocalls.util.Constants

object NotificationHelper {

    fun createCallChannel(context: Context) {
        val channel = NotificationChannel(
            Constants.NOTIFICATION_CHANNEL_ID,
            "Incoming Calls",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Notifications for incoming video calls"
            // Service handles ringtone directly — disable channel-level sound/vibration
            setSound(null, null)
            enableVibration(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        val activeChannel = NotificationChannel(
            Constants.ACTIVE_CALL_CHANNEL_ID,
            "Active Calls",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Ongoing call notification"
            setSound(null, null)
            enableVibration(false)
        }

        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
        manager.createNotificationChannel(activeChannel)
    }

    fun buildRingingNotification(
        context: Context,
        callerName: String,
        callType: String,
        roomId: String,
        callUUID: String,
        callerId: String,
        callerPhoto: String?,
        roomPassword: String?
    ): Notification {
        // Full-screen intent: opens IncomingCallScreen
        val fullScreenIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("type", "call_invite")
            putExtra("callUUID", callUUID)
            putExtra("roomId", roomId)
            putExtra("callerId", callerId)
            putExtra("callerName", callerName)
            putExtra("callerPhoto", callerPhoto ?: "")
            putExtra("callType", callType)
            putExtra("roomPassword", roomPassword ?: "")
        }
        val fullScreenPendingIntent = PendingIntent.getActivity(
            context, callUUID.hashCode(), fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Answer action
        val answerIntent = Intent(context, CallActionReceiver::class.java).apply {
            action = CallActionReceiver.ACTION_ANSWER
            putExtra("callUUID", callUUID)
            putExtra("roomId", roomId)
            putExtra("callerId", callerId)
            putExtra("callerName", callerName)
            putExtra("callerPhoto", callerPhoto ?: "")
            putExtra("callType", callType)
            putExtra("roomPassword", roomPassword ?: "")
        }
        val answerPendingIntent = PendingIntent.getBroadcast(
            context, callUUID.hashCode() + 1, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Decline action
        val declineIntent = Intent(context, CallActionReceiver::class.java).apply {
            action = CallActionReceiver.ACTION_DECLINE
            putExtra("callUUID", callUUID)
        }
        val declinePendingIntent = PendingIntent.getBroadcast(
            context, callUUID.hashCode() + 2, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val callTypeLabel = if (callType == "group") "Group call" else "Video call"

        return NotificationCompat.Builder(context, Constants.NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle("Incoming Call")
            .setContentText("$callerName - $callTypeLabel")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(fullScreenPendingIntent)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .addAction(android.R.drawable.ic_menu_call, "Answer", answerPendingIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePendingIntent)
            .build()
    }

    fun showCallNotification(
        context: Context,
        callerName: String,
        callType: String,
        roomId: String,
        callUUID: String,
        callerId: String,
        callerPhoto: String?,
        roomPassword: String?
    ) {
        val notification = buildRingingNotification(
            context, callerName, callType, roomId, callUUID, callerId, callerPhoto, roomPassword
        )
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.notify(callUUID.hashCode(), notification)
    }

    fun showActiveCallNotification(context: Context, callerName: String, callType: String) {
        val hangUpIntent = Intent(context, CallActionReceiver::class.java).apply {
            action = CallActionReceiver.ACTION_HANG_UP
        }
        val hangUpPendingIntent = PendingIntent.getBroadcast(
            context, Constants.ACTIVE_CALL_NOTIFICATION_ID, hangUpIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val openPendingIntent = PendingIntent.getActivity(
            context, Constants.ACTIVE_CALL_NOTIFICATION_ID + 1, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val callTypeLabel = if (callType == "group") "Group call" else "Video call"

        val notification = NotificationCompat.Builder(context, Constants.ACTIVE_CALL_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle("$callTypeLabel in progress")
            .setContentText(callerName)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(openPendingIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Hang up", hangUpPendingIntent)
            .build()

        val manager = context.getSystemService(NotificationManager::class.java)
        manager.notify(Constants.ACTIVE_CALL_NOTIFICATION_ID, notification)
    }

    fun cancelActiveCallNotification(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(Constants.ACTIVE_CALL_NOTIFICATION_ID)
    }

    fun cancelNotification(context: Context, callUUID: String) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(callUUID.hashCode())
    }
}
