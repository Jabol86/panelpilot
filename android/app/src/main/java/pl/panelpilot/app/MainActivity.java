package pl.panelpilot.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;

/** Pełnoekranowy panel: WebView z pulpitem z Home Assistanta, czujniki, jasność i obrót. */
public class MainActivity extends Activity implements SensorEventListener {
    private static final String TAG = "PanelPilot";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private Config config;
    private FrameLayout root;
    private WebView web;
    private View error;
    private Tunnel tunnel;
    private SensorManager sensors;
    private String loadedFor = "";
    private float lastLux = -1;
    private int lastNear = -1;
    private float lastRaw = Float.NaN;
    private float proxBase = Float.NaN, proxLast = Float.NaN;
    private long lastLuxAt;
    private boolean failed;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        config = new Config(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        sensors = getSystemService(SensorManager.class);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        // Android 8 trzyma ekran główny (HOME) i zwykłe uruchomienie w osobnych stosach, więc mimo singleTask
        // mogą żyć dwie kopie: dwa pulpity naraz liczą, rysują i walczą o jasność. Zostaje najnowsza.
        if (live != null && live != this && !live.isFinishing()) live.finish();
        live = this;
    }

    private static MainActivity live;

    @Override
    protected void onResume() {
        super.onResume();
        immersive();
        if (config.url().isEmpty()) {
            startActivity(new Intent(this, SetupActivity.class));
            return;
        }
        String key = config.url() + "|" + config.shape() + "|" + config.name() + "|" + config.cssRotation() + "|" + config.rotation();
        if (!key.equals(loadedFor)) {
            loadedFor = key;
            rotate(config.rotation());
            load();
        } else if (web != null) {
            web.onResume();
        }
        listen(Sensor.TYPE_LIGHT);
        listen(Sensor.TYPE_PROXIMITY);
        // Ponownie zgłoś ostatnie odczyty: czujniki podają tylko zmiany.
        lastLux = -1;
        lastNear = -1;
        lastRaw = Float.NaN;
    }

    @Override
    protected void onPause() {
        sensors.unregisterListener(this);
        // Niewidoczny pulpit nie rysuje i nie animuje (JS i połączenie z HA działają dalej).
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (live == this) live = null;
        ui.removeCallbacksAndMessages(null);
        if (web != null) web.destroy();
        // Tunel zostaje dla procesu: nowa kopia ekranu użyje go ponownie.
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        // Panel jest ekranem głównym: „wstecz” nic nie zamyka.
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) immersive();
    }

    @SuppressWarnings("deprecation")
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    // ---- WebView ----

    private void load() {
        ui.removeCallbacksAndMessages(null);
        if (!config.secure()) {
            // Ten sam adres HA = ten sam tunel; przeładowanie strony nie zajmuje portu od nowa.
            Uri u = Uri.parse(config.url());
            try {
                tunnel = Tunnel.open(u.getHost(), u.getPort() > 0 ? u.getPort() : 80, Config.TUNNEL_PORT);
            } catch (IOException e) {
                Log.e(TAG, "tunel", e);
                showError("Nie można uruchomić połączenia lokalnego: " + e.getMessage() + "\nPonowna próba za kilka sekund…");
                ui.postDelayed(this::load, 5000);
                return;
            }
        } else {
            Tunnel.closeShared();
            tunnel = null;
        }
        hideError();
        createWeb();
        failed = false;
        web.loadUrl(config.base() + "/panelpilot_static/index.html");
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWeb() {
        if (web != null) {
            root.removeView(web);
            web.destroy();
        }
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // Kamery z go2rtc po http na stronie https.
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        web.addJavascriptInterface(new Bridge(), "PanelNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        root.addView(web, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private boolean ours(Uri uri) {
        Uri base = Uri.parse(config.base());
        return uri != null && base.getScheme().equals(uri.getScheme()) && base.getHost().equals(uri.getHost()) && base.getPort() == uri.getPort();
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            // Główna strona nie może wyjść poza Home Assistant (ramki kamer mogą).
            return r.isForMainFrame() && !ours(r.getUrl());
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (!r.isForMainFrame()) return;
            failed = true;
            showError("Brak połączenia z Home Assistant\n" + config.url());
            retry();
        }

        @Override
        public void onReceivedHttpError(WebView v, WebResourceRequest r, android.webkit.WebResourceResponse resp) {
            if (!r.isForMainFrame()) return;
            failed = true;
            showError(resp.getStatusCode() == 404
                    ? "W Home Assistant nie ma jeszcze integracji Panel Pilot.\nZainstaluj ją i dodaj w Ustawieniach."
                    : "Home Assistant odpowiedział błędem " + resp.getStatusCode());
            retry();
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            if (!failed) hideError();
            lastLux = -1;
            lastNear = -1;
            lastRaw = Float.NaN;
            // Czujnik zbliżenia zgłasza tylko zmiany: nowa strona dostaje ostatni stan po chwili.
            ui.postDelayed(() -> proxReport(proxLast), 2000);
        }

        @Override
        public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
            Log.w(TAG, "WebView zakończył działanie, tworzę nowy");
            root.removeView(v);
            v.destroy();
            web = null;
            ui.postDelayed(MainActivity.this::load, 1000);
            return true;
        }
    }

    private void retry() {
        ui.postDelayed(this::load, 10_000);
    }

    private PermissionRequest waiting;

    private class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest r) {
            // Tylko mikrofon i tylko dla strony panelu.
            boolean audio = false;
            for (String res : r.getResources()) audio |= PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res);
            if (!audio || !ours(r.getOrigin())) {
                r.deny();
                return;
            }
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                r.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                waiting = r;
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 1);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] names, int[] results) {
        if (waiting == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) waiting.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        else waiting.deny();
        waiting = null;
    }

    // ---- most JS ----

    private class Bridge {
        @JavascriptInterface
        public String info() {
            try {
                return new JSONObject().put("id", config.id()).put("name", config.name()).put("model", Config.model())
                        .put("shape", config.shape()).put("rotation", config.rotation()).put("cssRotation", config.cssRotation())
                        .put("version", getPackageManager().getPackageInfo(getPackageName(), 0).versionName).toString();
            } catch (JSONException | PackageManager.NameNotFoundException e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void setBrightness(int level) {
            ui.post(() -> {
                WindowManager.LayoutParams a = getWindow().getAttributes();
                a.screenBrightness = Math.max(0, Math.min(255, level)) / 255f;
                getWindow().setAttributes(a);
            });
        }

        @JavascriptInterface
        public void setRotation(int degrees) {
            ui.post(() -> rotate(degrees));
        }

        @JavascriptInterface
        public void openSetup() {
            ui.post(() -> startActivity(new Intent(MainActivity.this, SetupActivity.class)));
        }

        @JavascriptInterface
        public void reload() {
            ui.post(() -> {
                if (web != null) web.clearCache(true);
                load();
            });
        }
    }

    private void rotate(int degrees) {
        int o;
        if (config.cssRotation()) o = ActivityInfo.SCREEN_ORIENTATION_NOSENSOR;
        else if (degrees == 90) o = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;
        else if (degrees == 180) o = ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT;
        else if (degrees == 270) o = ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE;
        else o = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
        if (getRequestedOrientation() != o) setRequestedOrientation(o);
    }

    // ---- czujniki ----

    private void listen(int type) {
        Sensor s = sensors.getDefaultSensor(type);
        if (s != null) sensors.registerListener(this, s, SensorManager.SENSOR_DELAY_NORMAL);
        else Log.i(TAG, "brak czujnika " + type);
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        if (web == null) return;
        if (e.sensor.getType() == Sensor.TYPE_PROXIMITY) {
            // Czujniki różnie zgłaszają „daleko”: zwykle maksymalny zasięg, ale NSPanel Pro w spoczynku podaje 0,
            // a ruch ręki to krótki impuls 1. Dlatego „daleko” to odczyt spoczynkowy: pierwszy odczyt albo taki,
            // który trzyma się 30 s; „blisko” = wyraźnie inny odczyt.
            float v = e.values[0];
            if (Float.isNaN(proxBase)) proxBase = v;
            proxLast = v;
            ui.removeCallbacks(proxSettle);
            ui.postDelayed(proxSettle, 30_000);
            proxReport(v);
        } else {
            float lux = e.values[0];
            long now = System.currentTimeMillis();
            boolean big = lastLux < 0 || Math.abs(lux - lastLux) > Math.max(1f, lastLux * 0.1f);
            if (!big || now - lastLuxAt < 1000) return;
            lastLux = lux;
            lastLuxAt = now;
            push("lux", String.valueOf(Math.round(lux)));
        }
    }

    /** Odczyt trzymający się 30 s staje się spoczynkowym („daleko”). */
    private final Runnable proxSettle = () -> {
        if (Float.isNaN(proxLast) || proxLast == proxBase) return;
        proxBase = proxLast;
        proxReport(proxLast);
    };

    private void proxReport(float v) {
        if (web == null || Float.isNaN(v)) return;
        float scale = Math.max(1f, Math.max(Math.abs(v), Math.abs(proxBase)));
        int near = Math.abs(v - proxBase) > 0.4f * scale ? 1 : 0;
        if (v != lastRaw) {
            lastRaw = v;
            push("proximity_raw", String.valueOf(v));
        }
        if (near == lastNear) return;
        lastNear = near;
        push("proximity", String.valueOf(near));
    }

    private void push(String name, String value) {
        web.evaluateJavascript("window.Panel&&Panel.sensor&&Panel.sensor('" + name + "'," + value + ")", null);
    }

    @Override
    public void onAccuracyChanged(Sensor s, int a) {
        // nieużywane
    }

    // ---- ekran błędu ----

    private void hideError() {
        if (error != null) root.removeView(error);
        error = null;
    }

    private void showError(String text) {
        hideError();
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.BLACK);
        box.setPadding(40, 40, 40, 40);
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextColor(Color.LTGRAY);
        t.setTextSize(18);
        t.setGravity(Gravity.CENTER);
        box.addView(t);
        box.addView(button("Spróbuj ponownie", v -> load()));
        box.addView(button("Ustawienia", v -> startActivity(new Intent(this, SetupActivity.class))));
        error = box;
        root.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private Button button(String text, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(text);
        b.setOnClickListener(l);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = 24;
        b.setLayoutParams(p);
        return b;
    }
}
