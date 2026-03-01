package com.fpvideocalls

import android.app.Application
import android.content.Context
import com.fpvideocalls.crypto.ChatCryptoManager
import com.fpvideocalls.service.ChatSocketManager
import com.fpvideocalls.service.NotificationHelper
import com.fpvideocalls.util.AppLifecycle
import com.fpvideocalls.util.LocaleHelper
import com.google.firebase.auth.FirebaseAuth
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

@HiltAndroidApp
class FpVideoCallsApp : Application() {

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(LocaleHelper.applyLocale(base))
    }

    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createCallChannel(this)
        NotificationHelper.createChatChannel(this)
        AppLifecycle.init()

        // Initialize E2E crypto keys and chat socket when user is signed in
        FirebaseAuth.getInstance().addAuthStateListener { auth ->
            val user = auth.currentUser
            if (user != null) {
                appScope.launch { ChatCryptoManager.initialize(this@FpVideoCallsApp) }
                ChatSocketManager.connect(user.uid)
            } else {
                ChatSocketManager.disconnect()
            }
        }
    }
}
