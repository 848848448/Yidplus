package com.yidplus.app;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.util.Base64;
import android.webkit.*;
import android.widget.Toast;
import androidx.webkit.*;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.concurrent.Executors;

/** Bundled public UI, same-origin online API, and a narrowly scoped native bridge. */
public class MainActivity extends Activity {
 private WebView web;
 private ValueCallback<Uri[]> fileCallback;
 private PermissionRequest mediaRequest;
 private JavaScriptReplyProxy saveReply;
 private OutputStream saveStream;
 private long saveBytes, saveExpected;
 private String saveId;
 private static final long MAX_SAVE = 64L * 1024 * 1024;
 private String verifier;
 private long authStarted;
 private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
 private final Runnable saveTimeout = () -> abortSave("Save timed out");
 private static final Set<String> PAGES = new HashSet<>(Arrays.asList("/", "/index.html", "/chat", "/yidplus-chat.html", "/music", "/yidplus-music.html", "/shorts", "/yidplus-shorts.html", "/admin", "/yidplus-admin.html", "/privacy.html", "/terms.html", "/reset-password.html"));
 @Override public void onCreate(Bundle state) {
  super.onCreate(state);
  verifier=getSharedPreferences("native",MODE_PRIVATE).getString("authVerifier",null);authStarted=getSharedPreferences("native",MODE_PRIVATE).getLong("authStarted",0);
  web = new WebView(this); setContentView(web);
  WebSettings s = web.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
  s.setAllowFileAccess(false); s.setAllowContentAccess(false); s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  s.setMediaPlaybackRequiresUserGesture(true); s.setUserAgentString(s.getUserAgentString()+" YidplusAndroid/1.2.0");
  CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
  web.setWebViewClient(new WebViewClient() {
   @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
    Uri u=r.getUrl(); if(!"https".equals(u.getScheme()) || !"yidplus.com".equals(u.getHost()) || !"GET".equals(r.getMethod())) return null;
    String path=u.getPath(); String file=null;
    if(PAGES.contains(path)) { switch(path) {case "/":file="index.html";break;case "/chat":file="yidplus-chat.html";break;case "/music":file="yidplus-music.html";break;case "/shorts":file="yidplus-shorts.html";break;case "/admin":file="yidplus-admin.html";break;default:file=path.substring(1);} }
    else if(path!=null && path.matches("/(css|js|images)/[A-Za-z0-9_./-]+") && !path.contains("..")) file=path.substring(1);
    if(file==null)return null;
    try { String ext=file.substring(file.lastIndexOf('.')+1); String mime=ext.equals("js")?"application/javascript":ext.equals("css")?"text/css":ext.equals("html")?"text/html":ext.equals("png")?"image/png":ext.equals("svg")?"image/svg+xml":ext.equals("json")?"application/json":"application/octet-stream";
     Map<String,String> h=new HashMap<>();h.put("Cache-Control","no-store");h.put("X-Content-Type-Options","nosniff");
     return new WebResourceResponse(mime,"UTF-8",200,"OK",h,getAssets().open("site/"+file));
    }catch(IOException e){return null;}
   }
   @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r) {
    if(!r.isForMainFrame())return false; Uri u=r.getUrl();
    if("https".equals(u.getScheme()) && "yidplus.com".equals(u.getHost())) {
     if("/api/auth/google-login".equals(u.getPath())) {startGoogle();return true;}
     return false;
    }
    if("https".equals(u.getScheme()) || "mailto".equals(u.getScheme()) || "tel".equals(u.getScheme())) { external(u); }
    return true;
   }
   @Override public void onPageFinished(WebView v,String url) {
    if(bridgePage(Uri.parse(url))) { try {InputStream in=getAssets().open("native.js");ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);in.close();String code=new String(out.toByteArray(),StandardCharsets.UTF_8);web.evaluateJavascript(code,null);}catch(IOException ignored){} }
    CookieManager.getInstance().flush();
   }
  });
  web.setWebChromeClient(new WebChromeClient() {
   @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> callback,FileChooserParams params) {
    if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=callback;
    Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
    try{startActivityForResult(i,20);}catch(ActivityNotFoundException e){fileCallback.onReceiveValue(null);fileCallback=null;return false;}return true;
   }
   @Override public void onPermissionRequest(PermissionRequest r) {
    runOnUiThread(()->{ if(!bridgePage(r.getOrigin())) {r.deny();return;} List<String> permissions=new ArrayList<>();
     for(String resource:r.getResources()) {if(resource.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE))permissions.add(Manifest.permission.RECORD_AUDIO);else if(resource.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE))permissions.add(Manifest.permission.CAMERA);else{r.deny();return;}}
     if(permissions.isEmpty()){r.deny();return;}if(mediaRequest!=null)mediaRequest.deny();mediaRequest=r;requestPermissions(permissions.toArray(new String[0]),21);
    });
   }
   @Override public void onPermissionRequestCanceled(PermissionRequest r){if(mediaRequest==r)mediaRequest=null;}
  });
  if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.addWebMessageListener(web,"YidplusNative",Collections.singleton("https://yidplus.com"),(view,message,origin,mainFrame,reply)->{
   if(!mainFrame || !bridgePage(Uri.parse(web.getUrl()==null?"":web.getUrl())) || !"https".equals(origin.getScheme()) || !"yidplus.com".equals(origin.getHost()))return;
   String raw=message.getData();if(raw==null||raw.length()>100000)return;
   try{JSONObject m=new JSONObject(raw);String type=m.optString("type");
    if(type.equals("saveBegin")){if(saveReply!=null){reply.postMessage("{\"error\":\"Another save is in progress\"}");return;}long size=m.optLong("size",-1);if(size<0||size>MAX_SAVE){reply.postMessage("{\"error\":\"File exceeds 64 MB\"}");return;}
     saveReply=reply;saveExpected=size;saveBytes=0;saveId=m.getString("id");String name=m.optString("name","download.mp3").replaceAll("[^\\p{L}\\p{N} ._()-]","_");if(name.length()>120)name=name.substring(0,120);
     Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/octet-stream");i.putExtra(Intent.EXTRA_TITLE,name);startActivityForResult(i,22);resetSaveTimeout();
    } else if(type.equals("saveChunk")&&saveReply!=null&&saveId.equals(m.optString("id"))&&saveStream!=null) {
     byte[] bytes=Base64.decode(m.getString("data"),Base64.NO_WRAP);if(bytes.length>49152||saveBytes+bytes.length>saveExpected)throw new IOException("Invalid save size");saveStream.write(bytes);saveBytes+=bytes.length;resetSaveTimeout();reply.postMessage("{\"ack\":true}");
    }else if(type.equals("saveEnd")&&saveReply!=null&&saveId.equals(m.optString("id"))&&saveStream!=null){if(saveBytes!=saveExpected)throw new IOException("Incomplete file");saveStream.close();saveStream=null;reply.postMessage("{\"done\":true}");clearSave();toast("File saved");
    }else if(type.equals("saveAbort")){abortSave("Save cancelled");}
    else if(type.equals("googleLogin")){startGoogle();}
    else if(type.equals("pushId")){reply.postMessage(new JSONObject().put("id",getSharedPreferences("native",MODE_PRIVATE).getString("id","")).toString());}
    else if(type.equals("pushSetup")){
     if(android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},23);reply.postMessage("{\"error\":\"Allow notifications, then tap Enable again\"}");return;}
     com.google.firebase.messaging.FirebaseMessaging.getInstance().setAutoInitEnabled(true);
     com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task->{try{if(!task.isSuccessful()){reply.postMessage("{\"error\":\"Notifications could not be enabled\"}");return;}
      String id=getSharedPreferences("native",MODE_PRIVATE).getString("id",null);if(id==null){id=java.util.UUID.randomUUID().toString().replace("-","");getSharedPreferences("native",MODE_PRIVATE).edit().putString("id",id).apply();}
      reply.postMessage(new JSONObject().put("token",task.getResult()).put("id",id).toString());
     }catch(Exception ignored){}});
    }else if(type.equals("pushSignedIn")){getSharedPreferences("native",MODE_PRIVATE).edit().putBoolean("signedIn",m.optBoolean("value",false)).apply();}

   }catch(Exception e){abortSave("Could not save file");}
  });
  web.setDownloadListener((url,ua,disposition,mime,length)->{
   try{Uri u=Uri.parse(url);if(!"https".equals(u.getScheme())||!"yidplus.com".equals(u.getHost())){toast("Use the file's Save button");return;}
    DownloadManager.Request request=new DownloadManager.Request(u);String cookie=CookieManager.getInstance().getCookie(url);if(cookie!=null)request.addRequestHeader("Cookie",cookie);
    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);request.setTitle(URLUtil.guessFileName(url,disposition,mime));request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,URLUtil.guessFileName(url,disposition,mime));
    ((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
   }catch(Exception e){toast("Could not start download");}
  });
  String initial=getIntent().getStringExtra("push_path");web.loadUrl("https://yidplus.com"+(initial!=null&&initial.matches("/(chat|music|shorts|admin)?([?#].*)?")?initial:"/"));
  if(getIntent().getData()!=null)onNewIntent(getIntent());
 }
 private boolean bridgePage(Uri u){return u!=null&&"https".equals(u.getScheme())&&"yidplus.com".equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443)&&PAGES.contains(u.getPath());}
 private void external(Uri u){try{startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(ActivityNotFoundException e){toast("No app can open this link");}}
 private void toast(String text){Toast.makeText(this,text,Toast.LENGTH_SHORT).show();}
 private void resetSaveTimeout(){handler.removeCallbacks(saveTimeout);handler.postDelayed(saveTimeout,120000);}
 private void clearSave(){handler.removeCallbacks(saveTimeout);saveReply=null;saveId=null;saveBytes=0;saveExpected=0;}
 private void abortSave(String error){try{if(saveStream!=null)saveStream.close();}catch(IOException ignored){}saveStream=null;if(saveReply!=null){try{saveReply.postMessage(new JSONObject().put("error",error).toString());}catch(Exception ignored){}}clearSave();}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);
  if(request==20&&fileCallback!=null){Uri[] uris=null;if(result==RESULT_OK&&data!=null){if(data.getClipData()!=null){uris=new Uri[data.getClipData().getItemCount()];for(int n=0;n<uris.length;n++)uris[n]=data.getClipData().getItemAt(n).getUri();}else if(data.getData()!=null)uris=new Uri[]{data.getData()};}fileCallback.onReceiveValue(uris);fileCallback=null;}
  if(request==22&&saveReply!=null){if(result!=RESULT_OK||data==null||data.getData()==null){abortSave("Save cancelled");return;}try{saveStream=getContentResolver().openOutputStream(data.getData(),"wt");if(saveStream==null)throw new IOException();saveReply.postMessage("{\"ready\":true}");resetSaveTimeout();}catch(IOException e){abortSave("Could not open file");}}
 }
 @Override public void onRequestPermissionsResult(int r,String[] p,int[] g){super.onRequestPermissionsResult(r,p,g);if(r==21&&mediaRequest!=null){boolean ok=g.length>0;for(int v:g)if(v!=PackageManager.PERMISSION_GRANTED)ok=false;if(ok)mediaRequest.grant(mediaRequest.getResources());else mediaRequest.deny();mediaRequest=null;}}
 private void startGoogle(){try{byte[] b=new byte[32];new SecureRandom().nextBytes(b);verifier=Base64.encodeToString(b,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);String challenge=Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);authStarted=System.currentTimeMillis();getSharedPreferences("native",MODE_PRIVATE).edit().putString("authVerifier",verifier).putLong("authStarted",authStarted).apply();String target="/native-login-complete?challenge="+challenge;external(Uri.parse("https://yidplus.com/api/auth/google-login?return_to="+Uri.encode(target)));}catch(Exception e){toast("Could not start Google sign-in");}}
 @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);String path=intent.getStringExtra("push_path");if(path!=null&&path.matches("/(chat|music|shorts|admin)?([?#].*)?")){web.loadUrl("https://yidplus.com"+path);return;}Uri u=intent.getData();if(u==null||!"yidplus".equals(u.getScheme())||!"auth".equals(u.getHost())||verifier==null||System.currentTimeMillis()-authStarted>600000)return;String code=u.getQueryParameter("code");if(code==null||!code.matches("[0-9a-f]{64}"))return;String v=verifier;verifier=null;getSharedPreferences("native",MODE_PRIVATE).edit().remove("authVerifier").remove("authStarted").apply();
  Executors.newSingleThreadExecutor().execute(()->{try{HttpURLConnection c=(HttpURLConnection)new URL("https://yidplus.com/api/auth/native-exchange").openConnection();c.setRequestMethod("POST");c.setConnectTimeout(20000);c.setReadTimeout(20000);c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");byte[] body=new JSONObject().put("code",code).put("verifier",v).toString().getBytes(StandardCharsets.UTF_8);try(OutputStream out=c.getOutputStream()){out.write(body);}if(c.getResponseCode()!=200)throw new IOException();List<String> cookies=c.getHeaderFields().get("Set-Cookie");if(cookies==null)cookies=c.getHeaderFields().get("set-cookie");if(cookies==null)throw new IOException();final List<String> receivedCookies=cookies;c.disconnect();runOnUiThread(()->{java.util.concurrent.atomic.AtomicInteger remaining=new java.util.concurrent.atomic.AtomicInteger(receivedCookies.size());for(String cookie:receivedCookies)CookieManager.getInstance().setCookie("https://yidplus.com",cookie,ok->{if(remaining.decrementAndGet()==0){CookieManager.getInstance().flush();web.loadUrl("https://yidplus.com/");}});});}catch(Exception e){runOnUiThread(()->toast("Sign-in could not finish. Please try again."));}});
 }
 @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
 @Override protected void onDestroy(){abortSave("App closed");if(fileCallback!=null)fileCallback.onReceiveValue(null);if(mediaRequest!=null)mediaRequest.deny();web.destroy();super.onDestroy();}
}
