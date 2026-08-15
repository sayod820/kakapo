package tj.kakapo.trade;

import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private static final int COLOR_DARK = 0xFF070C09;
  private static final int COLOR_LIGHT = 0xFFF3F7F4;
  private static final String PREFS = "kakapo_trade";
  private static final String PREF_CHROME = "chrome_color";
  private boolean bridgeAttached = false;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    SplashScreen.installSplashScreen(this);
    super.onCreate(savedInstanceState);
    hideSystemUi();
    configureWebView();
    applyChromeColor(loadSavedChromeColor());
    openTradeUi();
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

  private int loadSavedChromeColor() {
    SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
    String hex = prefs.getString(PREF_CHROME, null);
    if (hex != null) {
      try {
        return Color.parseColor(hex.trim());
      } catch (Exception ignored) {
      }
    }
    return COLOR_LIGHT;
  }

  private void saveChromeColor(int color) {
    String hex = String.format("#%06X", (0xFFFFFF & color));
    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(PREF_CHROME, hex).apply();
  }

  private void hideSystemUi() {
    Window window = getWindow();
    if (window == null) return;

    WindowCompat.setDecorFitsSystemWindows(window, false);
    window.clearFlags(WindowManager.LayoutParams.FLAG_FORCE_NOT_FULLSCREEN);
    window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
    window.setStatusBarColor(Color.TRANSPARENT);
    window.setNavigationBarColor(Color.TRANSPARENT);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.setNavigationBarContrastEnforced(false);
      window.setStatusBarContrastEnforced(false);
    }

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
      controller.show(
        WindowInsetsCompat.Type.navigationBars()
      );
      controller.hide(WindowInsetsCompat.Type.statusBars());
      controller.setSystemBarsBehavior(
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      );
    }

    decor.setSystemUiVisibility(
      View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        | View.SYSTEM_UI_FLAG_FULLSCREEN
        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
    );
  }

  private void openTradeUi() {
    if (this.bridge == null) return;
    WebView webView = this.bridge.getWebView();
    if (webView == null) return;
    webView.post(() -> {
      String url = webView.getUrl();
      if (url == null) {
        webView.loadUrl("https://localhost/trade/index.html");
        return;
      }
      boolean atRoot = url.matches("https://localhost/?")
        || url.equals("https://localhost/index.html")
        || url.endsWith("://localhost/");
      if (atRoot && !url.contains("/trade")) {
        webView.loadUrl("https://localhost/trade/index.html");
      }
    });
  }

  private void configureWebView() {
    if (this.bridge == null) return;
    WebView webView = this.bridge.getWebView();
    if (webView == null) return;

    int chrome = loadSavedChromeColor();
    webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
    webView.setNestedScrollingEnabled(true);
    webView.setVerticalScrollBarEnabled(false);
    webView.setHorizontalScrollBarEnabled(false);
    webView.setBackgroundColor(chrome);
    webView.setPadding(0, 0, 0, 0);
    webView.getSettings().setJavaScriptEnabled(true);
    webView.getSettings().setDomStorageEnabled(true);
    webView.getSettings().setDatabaseEnabled(true);
    webView.getSettings().setAllowFileAccess(true);
    webView.getSettings().setAllowContentAccess(true);
    webView.getSettings().setSupportZoom(false);
    webView.getSettings().setBuiltInZoomControls(false);
    webView.getSettings().setDisplayZoomControls(false);

    ViewGroup.LayoutParams lp = webView.getLayoutParams();
    if (lp != null) {
      lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
      lp.height = ViewGroup.LayoutParams.MATCH_PARENT;
      webView.setLayoutParams(lp);
    }

    View parent = (View) webView.getParent();
    if (parent != null) {
      parent.setPadding(0, 0, 0, 0);
      parent.setBackgroundColor(chrome);
      ViewCompat.setOnApplyWindowInsetsListener(parent, (v, insets) -> {
        v.setPadding(0, 0, 0, 0);
        return WindowInsetsCompat.CONSUMED;
      });
    }

    ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
      v.setPadding(0, 0, 0, 0);
      // Only the camera cutout — NOT full status-bar height (that made a huge gap under the camera).
      Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
      int top = Math.max(0, cutout.top);
      ((WebView) v).evaluateJavascript(
        "document.documentElement&&document.documentElement.style.setProperty('--kakapo-notch','"
          + top
          + "px');",
        null
      );
      return WindowInsetsCompat.CONSUMED;
    });
    ViewCompat.requestApplyInsets(webView);

    if (!bridgeAttached) {
      webView.addJavascriptInterface(new KakapoBridge(), "KakapoAndroid");
      bridgeAttached = true;
    }
  }

  private void applyChromeColor(int color) {
    saveChromeColor(color);
    runOnUiThread(() -> {
      Window window = getWindow();
      if (window != null) {
        window.setBackgroundDrawable(new ColorDrawable(color));
        window.setStatusBarColor(color);
        window.setNavigationBarColor(color);
        View decor = window.getDecorView();
        if (decor != null) decor.setBackgroundColor(color);
      }
      if (this.bridge != null) {
        WebView webView = this.bridge.getWebView();
        if (webView != null) {
          webView.setBackgroundColor(color);
          View parent = (View) webView.getParent();
          if (parent != null) parent.setBackgroundColor(color);
        }
      }
      int r = (color >> 16) & 0xFF;
      int g = (color >> 8) & 0xFF;
      int b = color & 0xFF;
      boolean light = (r * 299 + g * 587 + b * 114) >= 140000;
      WindowInsetsControllerCompat controller =
        window != null
          ? WindowCompat.getInsetsController(window, window.getDecorView())
          : null;
      if (controller != null) {
        controller.setAppearanceLightStatusBars(light);
        controller.setAppearanceLightNavigationBars(light);
      }
    });
  }

  public class KakapoBridge {
    @JavascriptInterface
    public void setTheme(String theme) {
      boolean light = theme != null && theme.toLowerCase().contains("light");
      applyChromeColor(light ? COLOR_LIGHT : COLOR_DARK);
    }

    @JavascriptInterface
    public void setChromeColor(String hex) {
      if (hex == null || hex.length() < 4) return;
      try {
        int color = Color.parseColor(hex.trim());
        applyChromeColor(color);
      } catch (Exception ignored) {
      }
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
      + "html.kakapo-android{--kakapo-notch:env(safe-area-inset-top,0px);--kakapo-bg:#F3F7F4;--kakapo-panel:#FFFFFF;"
      + "background:var(--kakapo-bg)!important;}"
      + "html.kakapo-android.kakapo-theme-light{--kakapo-bg:#F3F7F4;--kakapo-panel:#FFFFFF;}"
      + "html.kakapo-android.kakapo-theme-dark{--kakapo-bg:#070C09;--kakapo-panel:#0B120E;}"
      + "html.kakapo-android,html.kakapo-android body,html.kakapo-android #__next{"
      + "height:100%!important;max-height:100%!important;width:100%!important;"
      + "margin:0!important;overflow:hidden!important;overscroll-behavior:none!important;"
      + "background:var(--kakapo-bg)!important;}"
      + "html.kakapo-android body{padding:0!important;box-sizing:border-box!important;"
      + "position:fixed!important;inset:0;}"
      /* Shell: fixed height flex column */
      + "html.kakapo-android .k-trade{"
      + "height:100%!important;min-height:0!important;max-height:100%!important;"
      + "overflow:hidden!important;overscroll-behavior:none!important;"
      + "background:var(--bg,var(--kakapo-bg))!important;"
      + "display:flex!important;flex-direction:column!important;"
      + "padding-top:var(--kakapo-notch)!important;box-sizing:border-box!important;}"
      + "html.kakapo-android .k-trade:has(.k-top){padding-top:0!important;}"
      + "html.kakapo-android .k-top{"
      + "flex:0 0 auto!important;"
      + "padding-top:calc(10px + var(--kakapo-notch))!important;"
      + "background:var(--panel,var(--kakapo-panel))!important;}"
      /*
       * CRITICAL: flex 1 1 0% + min-height 0 gives .k-main a bounded height
       * so overflow-y:auto actually scrolls. height:auto made it grow forever → no scroll.
       */
      + "html.kakapo-android .k-main{"
      + "flex:1 1 0%!important;min-height:0!important;max-height:none!important;height:auto!important;"
      + "width:100%!important;display:flex!important;flex-direction:column!important;"
      + "overflow-x:auto!important;overflow-y:auto!important;"
      + "-webkit-overflow-scrolling:touch!important;overscroll-behavior:contain!important;"
      + "padding-bottom:56px!important;}"
      /* Default pages: body grows, .k-main scrolls */
      + "html.kakapo-android .k-body{"
      + "flex:0 0 auto!important;height:auto!important;min-height:0!important;"
      + "overflow:visible!important;}"
      /* POS/debts: nested. Warehouse/products/Сроки: scroll via .k-main */
      + "html.kakapo-android .k-main:has(.k-body-pos),"
      + "html.kakapo-android .k-main:has(.k-body-debts){overflow:hidden!important;}"
      + "html.kakapo-android .k-body-pos,"
      + "html.kakapo-android .k-body-debts{"
      + "flex:1 1 0%!important;min-height:0!important;height:auto!important;"
      + "overflow:hidden!important;display:flex!important;flex-direction:column!important;}"
      + "html.kakapo-android .k-body-debts > .k-debts-page,"
      + "html.kakapo-android .k-debts-page{"
      + "flex:1 1 0%!important;min-height:0!important;height:auto!important;"
      + "display:flex!important;flex-direction:column!important;overflow:hidden!important;}"
      + "html.kakapo-android .k-body-warehouse,"
      + "html.kakapo-android .k-body-warehouse > .k-wh-shell,"
      + "html.kakapo-android .k-wh-shell > .k-wh-body,"
      + "html.kakapo-android .k-wh-shell > .k-wh-body > .k-wh-stock,"
      + "html.kakapo-android .k-wh-shell > .k-wh-body > .k-wh-receipts,"
      + "html.kakapo-android .k-wh-shell > .k-wh-body > .k-wh-writeoffs,"
      + "html.kakapo-android .k-wh-shell > .k-wh-body > .k-wh-revisions,"
      + "html.kakapo-android .k-wh-shell > .k-wh-body > .k-wh-expiry,"
      + "html.kakapo-android .k-body-products,"
      + "html.kakapo-android .k-body-products > .k-products-mod,"
      + "html.kakapo-android .k-products-mod,"
      + "html.kakapo-android .k-products-mod-body,"
      + "html.kakapo-android .k-catalog-shell{"
      + "flex:none!important;height:auto!important;min-height:0!important;max-height:none!important;"
      + "overflow:visible!important;}"
      + "html.kakapo-android .k-wh-body,"
      + "html.kakapo-android .k-wh-stock-body,"
      + "html.kakapo-android .k-wh-panel-body,"
      + "html.kakapo-android .k-wh-receipts-body,"
      + "html.kakapo-android .k-catalog-body,"
      + "html.kakapo-android .k-product-list-body{"
      + "flex:none!important;height:auto!important;max-height:none!important;overflow:visible!important;}"
      + "html.kakapo-android .k-debts-list-b,"
      + "html.kakapo-android .k-debts-detail-b,"
      + "html.kakapo-android .k-nav,"
      + "html.kakapo-android .k-modal-b,"
      + "html.kakapo-android .k-rev-scroll,"
      + "html.kakapo-android .k-side .k-nav{"
      + "flex:1 1 0%!important;min-height:0!important;"
      + "overflow-x:auto!important;overflow-y:auto!important;"
      + "-webkit-overflow-scrolling:touch!important;overscroll-behavior:contain!important;}"
      + "html.kakapo-android .k-catalog-head,"
      + "html.kakapo-android .k-wh-head{flex:0 0 auto!important;}"
      + "html.kakapo-android .k-tbl-scroll{"
      + "overflow-x:auto!important;overflow-y:visible!important;"
      + "-webkit-overflow-scrolling:touch!important;}"
      + "html.kakapo-android .k-bottom-nav{padding:2px 2px 2px!important;bottom:0!important;}"
      + "html.kakapo-android .k-wh-fab,html.kakapo-android .k-prod-fab,"
      + "html.kakapo-android .k-cli-fab,html.kakapo-android .k-sup-fab,"
      + "html.kakapo-android .k-wo-fab,html.kakapo-android .k-rev-fab{bottom:58px!important;}"
      + "html.kakapo-android .k-finance-mod{padding-bottom:120px!important;}"
      + "html.kakapo-android .k-reports-mod{padding-bottom:56px!important;}"
      + "';"
      + "d.head.appendChild(s);}"
      + "if(!window.__kakapoHwBack){window.__kakapoHwBack=true;"
      + "try{var App=window.Capacitor&&Capacitor.Plugins&&Capacitor.Plugins.App;"
      + "if(App&&App.addListener){App.addListener('backButton',function(){"
      + "if(window.__kakapoHandleBack&&window.__kakapoHandleBack())return;"
      + "if(window.history&&window.history.length>1){window.history.back();return;}"
      + "if(App.minimizeApp){App.minimizeApp();}"
      + "});}}catch(e){}}"
      + "}"
      + "window.__kakapoSyncTheme=function(){"
      + "var t='';var bg='';var panel='';"
      + "try{t=localStorage.getItem('kakapo_trade_pos_theme')||'';}catch(e){}"
      + "var el=d.querySelector('.k-trade[data-theme],.pos-root[data-theme]');"
      + "if(el){var dt=el.getAttribute('data-theme');if(dt)t=dt;"
      + "try{var cs=getComputedStyle(el);"
      + "bg=(cs.getPropertyValue('--bg')||'').trim();"
      + "panel=(cs.getPropertyValue('--panel')||'').trim();}catch(e){}}"
      + "if(!t)t='light';"
      + "var light=String(t).toLowerCase().indexOf('light')>=0;"
      + "if(!bg){bg=light?'#F3F7F4':'#070C09';}"
      + "if(!panel){panel=light?'#FFFFFF':'#0B120E';}"
      + "de.classList.toggle('kakapo-theme-light',light);"
      + "de.classList.toggle('kakapo-theme-dark',!light);"
      + "de.style.setProperty('--kakapo-bg',bg);"
      + "de.style.setProperty('--kakapo-panel',panel);"
      + "de.style.background=bg;"
      + "if(d.body){d.body.style.background=bg;}"
      + "var chrome=d.querySelector('.k-top')?panel:bg;"
      + "try{"
      + "if(window.KakapoAndroid&&KakapoAndroid.setChromeColor){KakapoAndroid.setChromeColor(chrome);}"
      + "}catch(e){}"
      + "};"
      + "window.__kakapoSyncTheme();"
      + "setTimeout(window.__kakapoSyncTheme,50);"
      + "setTimeout(window.__kakapoSyncTheme,300);"
      + "setTimeout(window.__kakapoSyncTheme,1000);"
      + "if(!window.__kakapoThemeMo){"
      + "try{var mo=new MutationObserver(function(){window.__kakapoSyncTheme();});"
      + "mo.observe(de,{attributes:true,attributeFilter:['data-theme','class']});"
      + "if(d.body){mo.observe(d.body,{attributes:true,subtree:true,attributeFilter:['data-theme','class']});}"
      + "window.__kakapoThemeMo=mo;}catch(e){}"
      + "}"
      + "try{var C=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.StatusBar;"
      + "if(C){if(C.hide){C.hide();}if(C.setOverlaysWebView){C.setOverlaysWebView({overlay:true});}}}catch(e){}"
      + "})();";

    webView.post(() -> webView.evaluateJavascript(js, null));
  }
}
