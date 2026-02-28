package com.fpvideocalls

import android.app.Application
import android.content.Context
import com.fpvideocalls.service.NotificationHelper
import com.fpvideocalls.util.LocaleHelper
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class FpVideoCallsApp : Application() {
    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(LocaleHelper.applyLocale(base))
    }

    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createCallChannel(this)
    }
}
