package tj.kakapo.store;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private static final int COLOR_BG = 0xFF030B05;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    SplashScreen.installSplashScreen(this);
    super.onCreate(savedInstanceState);
    hideSystemUi();
    configureWebView();
    injectStoreFlag();
  }

  @Override
  public void onStart() {
    super.onStart();
    hideSystemUi();
    injectStoreFlag();
  }

  @Override
  public void onResume() {
    super.onResume();
    hideSystemUi();
    injectStoreFlag();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      hideSystemUi();
      injectStoreFlag();
    }
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
    WindowInsetsControllerCompat ctrl = WindowCompat.getInsetsController(window, decor);
    if (ctrl != null) {
      ctrl.setAppearanceLightStatusBars(false);
      ctrl.setAppearanceLightNavigationBars(false);
      ctrl.hide(androidx.core.view.WindowInsetsCompat.Type.statusBars());
      ctrl.hide(androidx.core.view.WindowInsetsCompat.Type.navigationBars());
      ctrl.setSystemBarsBehavior(
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      );
    }
    window.getDecorView().setBackgroundColor(COLOR_BG);
  }

  private void configureWebView() {
    if (this.bridge == null) return;
    WebView webView = this.bridge.getWebView();
    if (webView == null) return;
    webView.setBackgroundColor(COLOR_BG);
    webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
      webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
    }
  }

  private void injectStoreFlag() {
    if (this.bridge == null) return;
    WebView webView = this.bridge.getWebView();
    if (webView == null) return;

    final String js =
      "(function(){"
      + "window.kakapoStoreAndroid=true;"
      + "var d=document,de=d.documentElement;if(!de)return;"
      + "de.classList.add('kakapo-store-android');"
      + "var vp=d.querySelector('meta[name=viewport]');"
      + "if(vp){var c=vp.getAttribute('content')||'';"
      + "if(c.indexOf('viewport-fit')<0){vp.setAttribute('content',c+(c?',':'')+'viewport-fit=cover');}}"
      + "else{vp=d.createElement('meta');vp.name='viewport';"
      + "vp.content='width=device-width,initial-scale=1,viewport-fit=cover';d.head.appendChild(vp);}"
      + "if(!d.getElementById('kakapo-store-android-safe')){"
      + "var s=d.createElement('style');s.id='kakapo-store-android-safe';"
      + "s.textContent='"
      + "html.kakapo-store-android{--kakapo-notch:env(safe-area-inset-top,0px);"
      + "--kakapo-nav:env(safe-area-inset-bottom,0px);background:#030B05!important;}"
      + "html.kakapo-store-android,html.kakapo-store-android body,html.kakapo-store-android #__next{"
      + "min-height:100%!important;width:100%!important;margin:0!important;"
      + "background:#030B05!important;}"
      + "html.kakapo-store-android .store-top-bar{"
      + "padding-top:var(--kakapo-notch)!important;}"
      + "html.kakapo-store-android .store-top-bar-spacer{"
      + "height:calc(65px + var(--kakapo-notch))!important;}"
      + "';"
      + "d.head.appendChild(s);}"
      + "})();";

    webView.post(() -> webView.evaluateJavascript(js, null));
  }
}
