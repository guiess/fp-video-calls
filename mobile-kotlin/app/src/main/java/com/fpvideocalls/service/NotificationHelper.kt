package com.fpvideocalls.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import com.fpvideocalls.MainActivity
import com.fpvideocalls.R
import com.fpvideocalls.util.Constants

object NotificationHelper {

    /** Safe notification ID from callUUID — always positive and outside reserved range (9997-9999). */
    fun notificationId(callUUID: String): Int = (callUUID.hashCode() and 0x7FFFFFFF) or 0x10000

    fun createCallChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)

        // Delete legacy silent channel so the new one with sound/vibration takes effect
        @Suppress("DEPRECATION")
        manager.deleteNotificationChannel(Constants.LEGACY_CHANNEL_ID)

        val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        val channel = NotificationChannel(
            Constants.NOTIFICATION_CHANNEL_ID,
            context.getString(R.string.notification_channel_incoming),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = context.getString(R.string.notification_channel_incoming_desc)
            setSound(ringtoneUri, audioAttributes)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 1000, 500, 1000)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        val activeChannel = NotificationChannel(
            Constants.ACTIVE_CALL_CHANNEL_ID,
            context.getString(R.string.notification_channel_active),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = context.getString(R.string.notification_channel_active_desc)
            setSound(null, null)
            enableVibration(false)
        }

        val missedChannel = NotificationChannel(
            Constants.MISSED_CALL_CHANNEL_ID,
            context.getString(R.string.notification_channel_missed),
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = context.getString(R.string.notification_channel_missed_desc)
        }

        manager.createNotificationChannel(channel)
        manager.createNotificationChannel(activeChannel)
        manager.createNotificationChannel(missedChannel)
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
        // Full-screen intent: opens IncomingCallActivity (shows over lock screen)
        val fullScreenIntent = Intent(context, IncomingCallActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("callUUID", callUUID)
            putExtra("roomId", roomId)
            putExtra("callerId", callerId)
            putExtra("callerName", callerName)
            putExtra("callerPhoto", callerPhoto ?: "")
            putExtra("callType", callType)
            putExtra("roomPassword", roomPassword ?: "")
        }
        val fullScreenPendingIntent = PendingIntent.getActivity(
            context, notificationId(callUUID), fullScreenIntent,
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
            context, notificationId(callUUID) + 1, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Decline action
        val declineIntent = Intent(context, CallActionReceiver::class.java).apply {
            action = CallActionReceiver.ACTION_DECLINE
            putExtra("callUUID", callUUID)
            putExtra("roomId", roomId)
            putExtra("callerId", callerId)
        }
        val declinePendingIntent = PendingIntent.getBroadcast(
            context, notificationId(callUUID) + 2, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val callTypeLabel = context.getString(
            if (callType == "group") R.string.call_type_group else R.string.call_type_video
        )

        val builder = NotificationCompat.Builder(context, Constants.NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            // Suppress the notification's own sound/vibration — CallRingingService
            // handles continuous looping ringtone and vibration via AudioManagerHelper.
            .setSilent(true)
            .setContentIntent(fullScreenPendingIntent)
            .setFullScreenIntent(fullScreenPendingIntent, true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val caller = Person.Builder().setName(callerName).setImportant(true).build()
            builder.setStyle(
                NotificationCompat.CallStyle.forIncomingCall(caller, declinePendingIntent, answerPendingIntent)
            )
            builder.setContentText(callTypeLabel)
        } else {
            builder.setContentTitle(context.getString(R.string.notification_caller_calling, callerName))
                .setContentText(callTypeLabel)
                .addAction(android.R.drawable.ic_menu_call, context.getString(R.string.answer), answerPendingIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, context.getString(R.string.decline), declinePendingIntent)
        }

        return builder.build()
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
        manager.notify(notificationId(callUUID), notification)
    }

    fun buildActiveCallNotification(
        context: Context,
        callerName: String,
        callType: String,
        roomId: String,
        userId: String,
        password: String?
    ): Notification {
        val hangUpIntent = Intent(context, CallActionReceiver::class.java).apply {
            action = CallActionReceiver.ACTION_HANG_UP
        }
        val hangUpPendingIntent = PendingIntent.getBroadcast(
            context, Constants.ACTIVE_CALL_NOTIFICATION_ID, hangUpIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val openIntent = Intent(context, MainActivity::class.java).apply {
            action = "RETURN_TO_CALL"
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val openPendingIntent = PendingIntent.getActivity(
            context, Constants.ACTIVE_CALL_NOTIFICATION_ID + 1, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val callTypeLabel = context.getString(
            if (callType == "group") R.string.call_type_group else R.string.call_type_video
        )

        val builder = NotificationCompat.Builder(context, Constants.ACTIVE_CALL_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(openPendingIntent)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val person = Person.Builder().setName(callerName).setImportant(true).build()
            builder.setStyle(
                NotificationCompat.CallStyle.forOngoingCall(person, hangUpPendingIntent)
            )
            builder.setContentText(callTypeLabel)
        } else {
            builder.setContentTitle(context.getString(R.string.notification_active_call_title, callTypeLabel, callerName))
                .setContentText(context.getString(R.string.tap_return_to_call))
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, context.getString(R.string.hang_up), hangUpPendingIntent)
        }

        return builder.build()
    }

    fun showMissedCallNotification(context: Context, callerName: String, callType: String) {
        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("clearMissedCall", true)
        }
        val openPendingIntent = PendingIntent.getActivity(
            context, Constants.MISSED_CALL_NOTIFICATION_ID, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val callTypeLabel = context.getString(
            if (callType == "group") R.string.call_type_group else R.string.call_type_video
        ).replaceFirstChar { it.lowercase() }
        val notification = NotificationCompat.Builder(context, Constants.MISSED_CALL_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle(context.getString(R.string.notification_missed_call_title, callerName))
            .setContentText(context.getString(R.string.notification_missed_call_text, callTypeLabel))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openPendingIntent)
            .build()

        val manager = context.getSystemService(NotificationManager::class.java)
        manager.notify(Constants.MISSED_CALL_NOTIFICATION_ID, notification)
    }

    fun cancelMissedCallNotification(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(Constants.MISSED_CALL_NOTIFICATION_ID)
    }

    fun cancelActiveCallNotification(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(Constants.ACTIVE_CALL_NOTIFICATION_ID)
    }

    fun createChatChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            Constants.CHAT_CHANNEL_ID,
            context.getString(R.string.notification_channel_chat),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = context.getString(R.string.notification_channel_chat_desc)
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }

    fun showChatNotification(
        context: Context,
        senderName: String,
        messagePreview: String,
        conversationId: String
    ) {
        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("type", "chat_message")
            putExtra("conversationId", conversationId)
        }
        val openPendingIntent = PendingIntent.getActivity(
            context, conversationId.hashCode(), openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, Constants.CHAT_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(senderName)
            .setContentText(messagePreview)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openPendingIntent)
            .build()

        val manager = context.getSystemService(NotificationManager::class.java)
        manager.notify(Constants.CHAT_NOTIFICATION_ID_BASE + conversationId.hashCode().and(0xFFF), notification)
    }

    fun cancelNotification(context: Context, callUUID: String) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(notificationId(callUUID))
    }

    /** Cancel chat notification for a specific conversation. */
    fun cancelChatNotification(context: Context, conversationId: String) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(Constants.CHAT_NOTIFICATION_ID_BASE + conversationId.hashCode().and(0xFFF))
    }

    // ---- Location tracking notifications ----

    fun createLocationTrackingChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        // Delete legacy channels
        manager.deleteNotificationChannel("location_tracking")
        manager.deleteNotificationChannel("location_tracking_v2")

        val channel = NotificationChannel(
            Constants.LOCATION_TRACKING_CHANNEL_ID,
            context.getString(R.string.location_channel_name),
            NotificationManager.IMPORTANCE_MIN
        ).apply {
            description = context.getString(R.string.location_channel_desc)
            setSound(null, null)
            enableVibration(false)
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_SECRET
        }
        manager.createNotificationChannel(channel)
    }

    fun buildLocationTrackingNotification(context: Context): Notification {
        return NotificationCompat.Builder(context, Constants.LOCATION_TRACKING_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(context.getString(R.string.location_sharing_active))
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .setOngoing(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_DEFERRED)
            .build()
    }

    /** Cancel all call-related notifications (ringing, active, per-UUID). */
    fun cancelAllCallNotifications(context: Context, callUUID: String? = null) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(Constants.ACTIVE_CALL_NOTIFICATION_ID)
        manager.cancel(Constants.RINGING_SERVICE_NOTIFICATION_ID)
        callUUID?.let { manager.cancel(notificationId(it)) }
    }
}
