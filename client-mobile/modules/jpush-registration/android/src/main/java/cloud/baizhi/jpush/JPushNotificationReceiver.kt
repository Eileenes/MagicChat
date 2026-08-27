package cloud.baizhi.jpush

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import cn.jpush.android.api.NotificationMessage
import cn.jpush.android.service.JPushMessageReceiver

class JPushNotificationReceiver : JPushMessageReceiver() {
  override fun isNeedShowNotification(
    context: Context,
    message: NotificationMessage,
    notificationChannel: String
  ): Boolean {
    val process = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(process)
    return process.importance > ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  override fun onNotifyMessageOpened(
    context: Context,
    message: NotificationMessage
  ) {
    JPushNotificationResponses.record(
      context.applicationContext,
      message.msgId,
      message.notificationExtras
    )
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
      it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      context.startActivity(it)
    }
  }
}
