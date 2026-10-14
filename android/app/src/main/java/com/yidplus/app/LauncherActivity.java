package com.yidplus.app;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
/** Exact-domain intent handling. External pages stay in the browser. */
public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {
 @Override protected void onCreate(Bundle state) {
  Intent incoming=getIntent(); Uri url=incoming==null?null:incoming.getData();
  if(url!=null && !("https".equals(url.getScheme()) && "yidplus.com".equals(url.getHost()) && (url.getPort()==-1 || url.getPort()==443))) {
   incoming.setData(Uri.parse("https://yidplus.com/")); incoming.setAction(Intent.ACTION_VIEW);
  }
  super.onCreate(state);
 }
}
