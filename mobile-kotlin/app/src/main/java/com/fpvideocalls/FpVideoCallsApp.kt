package com.fpvideocalls

import android.app.Application
import com.fpvideocalls.service.NotificationHelper
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class FpVideoCallsApp : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createCallChannel(this)
    }
}
