package tj.kakapo.trade;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private static final int COLOR_DARK = 0xFF070C09;
  private static final int COLOR_LIGHT = 0xFFF3F7F4;
  private boolean bridgeAttached = false;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    SplashScreen.installSplashScreen(this);
    super.onCreate(savedInstanceState);
    hideSystemUi();
    configureWebView();
    applyChromeColor(COLOR_DARK);
    injectAndroidFlag();
  }

  @Override
  public void onStart() {
    super.onStart();
    hideSystemUi();
    injectAndroidFlag();
  }

  @Override
  public void onResume() {
    super.onResume();
    hideSystemUi();
    injectAndroidFlag();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      hideSystemUi();
      injectAndroidFlag();
    }
  }

  private void hideSystemUi() {
    Window window = getWindow();
    if (window == null) return;

    WindowCompat.setDecorFitsSystemWindows(window, false);
    window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
    window.clearFlags(WindowManager.LayoutParams.FLAG_FORCE_NOT_FULLSCREEN);
    window.setStatusBarColor(Color.TRANSPARENT);
    window.setNavigationBarColor(Color.TRANSPARENT);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      WindowManager.LayoutParams lp = window.getAttributes();
      lp.layoutInDisplayCutoutMode =
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
      window.setAttributes(lp);
    }

    View decor = window.getDecorView();
    WindowInsetsControllerCompat controller =
      WindowCompat.getInsetsController(window, decor);
    if (controller != null) {
      controller.hide(
        WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.navigationBars()
      );
      controller.setSystemBarsBehavior(
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      );
    }

    decor.setSystemUiVisibility(
      View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        | View.SYSTEM_UI_FLAG_FULLSCREEN
        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
    );
  }

  private void configureWebView() {
    if (this.bridge == null) return;
    WebView webView = this.bridge.getWebView();
    if (webView == null) return;
    webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
    webView.setNestedScrollingEnabled(false);
    webView.setVerticalScrollBarEnabled(false);
    webView.setHorizontalScrollBarEnabled(false);
    webView.setBackgroundColor(COLOR_DARK);
    webView.getSettings().setSupportZoom(false);
    webView.getSettings().setBuiltInZoomControls(false);
    webView.getSettings().setDisplayZoomControls(false);
    if (!bridgeAttached) {
      webView.addJavascriptInterface(new KakapoBridge(), "KakapoAndroid");
      bridgeAttached = true;
    }
  }

  private void applyChromeColor(int color) {
    runOnUiThread(() -> {
      Window window = getWindow();
      if (window != null) {
        window.setBackgroundDrawable(new ColorDrawable(color));
        View decor = window.getDecorView();
        if (decor != null) decor.setBackgroundColor(color);
      }
      if (this.bridge != null) {
        WebView webView = this.bridge.getWebView();
        if (webView != null) webView.setBackgroundColor(color);
      }
    });
  }

  public class KakapoBridge {
    @JavascriptInterface
    public void setTheme(String theme) {
      boolean light = theme != null && theme.toLowerCase().contains("light");
      applyChromeColor(light ? COLOR_LIGHT : COLOR_DARK);
    }
  }

  private void injectAndroidFlag() {
    if (this.bridge == null) return;
    WebView webView = this.bridge.getWebView();
    if (webView == null) return;

    final String js =
      "(function(){"
      + "window.kakapoAndroid=true;"
      + "var d=document,de=d.documentElement;if(!de)return;"
      + "de.classList.add('kakapo-android');"
      + "var vp=d.querySelector('meta[name=viewport]');"
      + "if(vp){var c=vp.getAttribute('content')||'';"
      + "if(c.indexOf('viewport-fit')<0){vp.setAttribute('content',c+(c?',':'')+'viewport-fit=cover');}}"
      + "else{vp=d.createElement('meta');vp.name='viewport';"
      + "vp.content='width=device-width,initial-scale=1,viewport-fit=cover';d.head.appendChild(vp);}"
      + "if(!d.getElementById('kakapo-android-safe')){"
      + "var s=d.createElement('style');s.id='kakapo-android-safe';"
      + "s.textContent='"
      + "html.kakapo-android{--kakapo-notch:max(34px,env(safe-area-inset-top,0px));--kakapo-bg:#070C09;background:var(--kakapo-bg)!important;}"
      + "html.kakapo-android.kakapo-theme-light{--kakapo-bg:#F3F7F4;}"
      + "html.kakapo-android.kakapo-theme-dark{--kakapo-bg:#070C09;}"
      + "html.kakapo-android body{margin:0!important;padding:0!important;padding-top:var(--kakapo-notch)!important;"
      + "box-sizing:border-box!important;background:var(--kakapo-bg)!important;height:100%!important;width:100%!important;"
      + "overflow:hidden!important;position:fixed!important;left:0;top:0;right:0;bottom:0;"
      + "overscroll-behavior:none!important;touch-action:manipulation;}"
      + "html.kakapo-android,#__next{height:100%!important;overflow:hidden!important;"
      + "overscroll-behavior:none!important;background:var(--kakapo-bg)!important;}"
      + "html.kakapo-android .k-trade{height:100%!important;min-height:0!important;overflow:hidden!important;"
      + "overscroll-behavior:none!important;background:var(--bg,var(--kakapo-bg))!important;}"
      + "html.kakapo-android .k-main,html.kakapo-android .k-body,html.kakapo-android .k-debts-list-b,"
      + "html.kakapo-android .k-debts-detail-b,html.kakapo-android .k-product-list,"
      + "html.kakapo-android .k-wh-stock-body,html.kakapo-android .k-wh-panel-body,"
      + "html.kakapo-android .k-modal-b,html.kakapo-android .k-side .k-nav{overscroll-behavior:contain!important;}"
      + "html.kakapo-android .k-bottom-nav{padding-bottom:max(8px,env(safe-area-inset-bottom,0px))!important;}"
      + "';"
      + "d.head.appendChild(s);}"
      + "window.__kakapoSyncTheme=function(){"
      + "var t='dark';"
      + "var el=d.querySelector('.k-trade[data-theme]');"
      + "if(el){t=el.getAttribute('data-theme')||'dark';}"
      + "var light=String(t).toLowerCase().indexOf('light')>=0;"
      + "de.classList.toggle('kakapo-theme-light',light);"
      + "de.classList.toggle('kakapo-theme-dark',!light);"
      + "var bg=light?'#F3F7F4':'#070C09';"
      + "de.style.background=bg;if(d.body){d.body.style.background=bg;}"
      + "try{if(window.KakapoAndroid&&KakapoAndroid.setTheme){KakapoAndroid.setTheme(light?'light':'dark');}}catch(e){}"
      + "};"
      + "window.__kakapoSyncTheme();"
      + "if(!window.__kakapoThemeMo){"
      + "try{var mo=new MutationObserver(function(){window.__kakapoSyncTheme();});"
      + "mo.observe(de,{attributes:true,attributeFilter:['data-theme','class']});"
      + "if(d.body){mo.observe(d.body,{attributes:true,subtree:true,attributeFilter:['data-theme','class']});}"
      + "window.__kakapoThemeMo=mo;}catch(e){}"
      + "}"
      + "if(!window.__kakapoTouchLock){"
      + "window.__kakapoTouchLock=true;"
      + "d.addEventListener('touchmove',function(e){"
      + "var n=e.target;"
      + "while(n&&n!==d.body&&n!==de){"
      + "var st=window.getComputedStyle(n);var oy=st.overflowY;"
      + "if((oy==='auto'||oy==='scroll')&&n.scrollHeight>n.clientHeight+1){return;}"
      + "n=n.parentElement;}"
      + "e.preventDefault();"
      + "},{passive:false});"
      + "}"
      + "try{var C=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.StatusBar;"
      + "if(C){if(C.hide){C.hide();}if(C.setOverlaysWebView){C.setOverlaysWebView({overlay:true});}}}catch(e){}"
      + "})();";

    webView.post(() -> webView.evaluateJavascript(js, null));
  }
}
