package com.yidplus.app;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Build;
import android.Manifest;
import android.content.pm.PackageManager;
import com.google.firebase.messaging.*;
public class PushService extends FirebaseMessagingService {
 @Override public void onNewToken(String token){getSharedPreferences("native",MODE_PRIVATE).edit().putString("token",token).apply();}
 @Override public void onMessageReceived(RemoteMessage message){
  if(!getSharedPreferences("native",MODE_PRIVATE).getBoolean("signedIn",false))return;
  if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;
  NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
  if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel("yidplus-messages","Messages",NotificationManager.IMPORTANCE_DEFAULT));
  String path=message.getData().get("url");
  if(path==null||!path.matches("/(chat|music|shorts|admin)?([?#].*)?")||path.contains("\\"))path="/chat";
  Intent intent=new Intent(this,MainActivity.class).putExtra("push_path",path).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
  PendingIntent pending=PendingIntent.getActivity(this,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,"yidplus-messages"):new Notification.Builder(this);
  manager.notify(100,builder.setSmallIcon(com.yidplus.app.R.mipmap.ic_launcher).setContentTitle("YID PLUS").setContentText("You have a new notification").setContentIntent(pending).setAutoCancel(true).build());
 }
}
