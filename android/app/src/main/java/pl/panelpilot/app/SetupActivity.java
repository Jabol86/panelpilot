package pl.panelpilot.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Pierwsze uruchomienie: wybór Home Assistanta znalezionego w sieci, kształt ekranu, obrót.
 * Wygląd jest w assets/setup.html, a ta klasa daje mu dostęp do ustawień (obiekt JS „Setup”).
 */
public class SetupActivity extends Activity {
    private static final String TAG = "Setup";
    private static final String PAGE = "file:///android_asset/setup.html";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Map<String, String> found = new LinkedHashMap<>();
    private Config config;
    private WebView web;
    private String scan = "searching";
    private NsdManager nsd;
    private NsdManager.DiscoveryListener listener;
    private WifiManager.MulticastLock lock;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        config = new Config(this);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.addJavascriptInterface(new Bridge(), "Setup");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return !PAGE.equals(r.getUrl().toString());
            }
        });
        setContentView(web);
        web.loadUrl(PAGE);
    }

    @Override
    protected void onStart() {
        super.onStart();
        discover();
    }

    @Override
    protected void onStop() {
        stopDiscovery();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        web.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (!config.url().isEmpty()) super.onBackPressed();
    }

    // ---- most JS ----

    private class Bridge {
        @JavascriptInterface
        public String info() {
            DisplayMetrics m = getResources().getDisplayMetrics();
            int w = Math.min(m.widthPixels, m.heightPixels), h = Math.max(m.widthPixels, m.heightPixels);
            try {
                JSONArray list = new JSONArray();
                synchronized (found) {
                    for (Map.Entry<String, String> e : found.entrySet()) list.put(new JSONObject().put("address", e.getKey()).put("name", e.getValue()));
                }
                return new JSONObject()
                        .put("url", config.url()).put("name", config.name()).put("shape", config.shape())
                        .put("rotation", config.rotation()).put("cssRotation", config.cssRotation())
                        .put("width", w).put("height", h).put("kind", (float) w / h > 0.85f ? "kwadrat" : "prostokąt")
                        .put("model", Config.model()).put("version", version())
                        .put("configured", !config.url().isEmpty()).put("scan", scan).put("found", list).toString();
            } catch (JSONException e) {
                return "{}";
            }
        }

        /** Podgląd obrotu od razu, jeszcze przed zapisaniem. */
        @JavascriptInterface
        public void rotate(int degrees, boolean css) {
            ui.post(() -> orient(degrees, css));
        }

        /** Zwraca pusty tekst albo opis błędu do pokazania przy polu adresu. */
        @JavascriptInterface
        public String save(String json) {
            try {
                JSONObject o = new JSONObject(json);
                String u = o.optString("url").trim();
                if (!u.isEmpty() && !u.contains("://")) u = "http://" + u;
                while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
                Uri p = Uri.parse(u);
                boolean scheme = "http".equals(p.getScheme()) || "https".equals(p.getScheme());
                if (!scheme || p.getHost() == null || p.getHost().isEmpty()) return "Podaj adres, np. http://192.168.1.10:8123";
                // Tylko serwer: ścieżka z przeglądarki nie jest potrzebna.
                String clean = p.getScheme() + "://" + p.getHost() + (p.getPort() > 0 ? ":" + p.getPort() : "");
                String shape = o.optString("shape", "auto");
                if (!shape.equals("square") && !shape.equals("rect")) shape = "auto";
                int r = o.optInt("rotation", 0);
                if (r != 90 && r != 180 && r != 270) r = 0;
                String n = o.optString("name").trim();
                config.save(clean, n.isEmpty() ? "Panel" : n, shape, r, o.optBoolean("cssRotation"));
                ui.post(() -> {
                    startActivity(new Intent(SetupActivity.this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));
                    finish();
                });
                return "";
            } catch (JSONException e) {
                return "Błędne dane";
            }
        }

        @JavascriptInterface
        public void home() { ui.post(() -> open(Settings.ACTION_HOME_SETTINGS)); }

        @JavascriptInterface
        public void system() { ui.post(() -> open(Settings.ACTION_SETTINGS)); }

        @JavascriptInterface
        public void forget() {
            ui.post(() -> {
                WebStorage.getInstance().deleteAllData();
                CookieManager.getInstance().removeAllCookies(null);
                Toast.makeText(SetupActivity.this, "Logowanie usunięte", Toast.LENGTH_SHORT).show();
            });
        }
    }

    private String version() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "?";
        }
    }

    private void orient(int degrees, boolean css) {
        int o;
        if (css) o = ActivityInfo.SCREEN_ORIENTATION_NOSENSOR;
        else if (degrees == 90) o = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;
        else if (degrees == 180) o = ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT;
        else if (degrees == 270) o = ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE;
        else o = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
        if (getRequestedOrientation() != o) setRequestedOrientation(o);
    }

    private void open(String action) {
        try {
            startActivity(new Intent(action));
        } catch (ActivityNotFoundException | SecurityException e) {
            Toast.makeText(this, "Ten panel nie udostępnia tego ekranu. Użyj ADB, jak w instrukcji.", Toast.LENGTH_LONG).show();
        }
    }

    private void js(String code) {
        ui.post(() -> web.evaluateJavascript(code, null));
    }

    // ---- wyszukiwanie HA (mDNS) ----

    private void discover() {
        nsd = getSystemService(NsdManager.class);
        if (nsd == null) {
            setScan("failed");
            return;
        }
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi != null) {
            lock = wifi.createMulticastLock("panelpilot");
            lock.setReferenceCounted(false);
            lock.acquire();
        }
        listener = new NsdManager.DiscoveryListener() {
            @Override public void onServiceFound(NsdServiceInfo s) { resolve(s); }
            @Override public void onServiceLost(NsdServiceInfo s) { }
            @Override public void onDiscoveryStarted(String t) { }
            @Override public void onDiscoveryStopped(String t) { }
            @Override public void onStartDiscoveryFailed(String t, int e) { setScan("failed"); }
            @Override public void onStopDiscoveryFailed(String t, int e) { }
        };
        try {
            nsd.discoverServices("_home-assistant._tcp", NsdManager.PROTOCOL_DNS_SD, listener);
        } catch (RuntimeException e) {
            Log.w(TAG, "mDNS", e);
            listener = null;
            setScan("failed");
        }
        ui.postDelayed(() -> {
            boolean empty;
            synchronized (found) { empty = found.isEmpty(); }
            if (empty && scan.equals("searching")) setScan("none");
        }, 10_000);
    }

    private void setScan(String s) {
        scan = s;
        js("window.onScan&&onScan(" + JSONObject.quote(s) + ")");
    }

    private void resolve(NsdServiceInfo service) {
        try {
            nsd.resolveService(service, new NsdManager.ResolveListener() {
                @Override public void onResolveFailed(NsdServiceInfo s, int e) { Log.w(TAG, "resolve " + e); }

                @Override
                public void onServiceResolved(NsdServiceInfo s) {
                    byte[] internal = s.getAttributes().get("internal_url");
                    String ip = s.getHost() == null ? null : s.getHost().getHostAddress();
                    String address = internal != null && internal.length > 0 ? new String(internal) : ip == null ? null : "http://" + (ip.contains(":") ? "[" + ip + "]" : ip) + ":" + s.getPort();
                    if (address == null) return;
                    synchronized (found) {
                        if (found.containsKey(address)) return;
                        found.put(address, s.getServiceName());
                    }
                    scan = "found";
                    js("window.onFound&&onFound(" + JSONObject.quote(s.getServiceName()) + "," + JSONObject.quote(address) + ")");
                }
            });
        } catch (RuntimeException e) {
            Log.w(TAG, "resolve", e);
        }
    }

    private void stopDiscovery() {
        if (listener != null) {
            try {
                nsd.stopServiceDiscovery(listener);
            } catch (RuntimeException e) {
                Log.w(TAG, "stop", e);
            }
            listener = null;
        }
        if (lock != null) lock.release();
    }
}
