package pl.panelpilot.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.LinkedHashSet;
import java.util.Set;

/** Pierwsze uruchomienie: wybór Home Assistanta znalezionego w sieci, kształt ekranu, obrót. */
public class SetupActivity extends Activity {
    private static final String TAG = "Setup";

    private Config config;
    private EditText url;
    private EditText name;
    private RadioGroup shape;
    private RadioGroup rotation;
    private CheckBox css;
    private LinearLayout found;
    private TextView searching;
    private NsdManager nsd;
    private NsdManager.DiscoveryListener listener;
    private WifiManager.MulticastLock lock;
    private final Set<String> seen = new LinkedHashSet<>();

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        config = new Config(this);
        int pad = dp(16);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad, pad, pad);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(box);
        setContentView(scroll);

        box.addView(text("PanelPilot", 26));
        box.addView(text("Home Assistant w Twojej sieci", 14));
        searching = text("Szukam…", 16);
        box.addView(searching);
        found = new LinearLayout(this);
        found.setOrientation(LinearLayout.VERTICAL);
        box.addView(found);

        box.addView(text("Adres Home Assistant", 14));
        url = edit(config.url().isEmpty() ? "" : config.url(), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        url.setHint("http://192.168.1.10:8123");
        box.addView(url);

        box.addView(text("Nazwa panelu", 14));
        name = edit(config.name(), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        box.addView(name);

        box.addView(text("Ekran", 14));
        shape = new RadioGroup(this);
        radio(shape, 1, "Wykryj automatycznie (" + detected() + ")", config.shape().equals("auto"));
        radio(shape, 2, "Kwadrat – NSPanel Pro (86)", config.shape().equals("square"));
        radio(shape, 3, "Prostokąt – NSPanel Pro 120", config.shape().equals("rect"));
        box.addView(shape);

        box.addView(text("Obrót na start (potem zmienisz go w Home Assistant)", 14));
        rotation = new RadioGroup(this);
        rotation.setOrientation(LinearLayout.HORIZONTAL);
        int[] degrees = {0, 90, 180, 270};
        for (int i = 0; i < 4; i++) radio(rotation, 10 + i, degrees[i] + "°", config.rotation() == degrees[i]);
        box.addView(rotation);
        css = new CheckBox(this);
        css.setText("Obracaj obraz w aplikacji (zaznacz, gdy ekran się nie obraca)");
        css.setChecked(config.cssRotation());
        box.addView(css);

        box.addView(button("Zapisz i uruchom", v -> save()));
        box.addView(button("Ustaw jako ekran główny", v -> open(Settings.ACTION_HOME_SETTINGS)));
        box.addView(button("Ustawienia Androida", v -> open(Settings.ACTION_SETTINGS)));
        if (!config.url().isEmpty()) box.addView(button("Zapomnij logowanie", v -> forget()));
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
    public void onBackPressed() {
        if (!config.url().isEmpty()) super.onBackPressed();
    }

    private String detected() {
        DisplayMetrics m = getResources().getDisplayMetrics();
        float r = (float) m.widthPixels / m.heightPixels;
        return m.widthPixels + "×" + m.heightPixels + (r > 0.85f && r < 1.18f ? ", kwadrat" : ", prostokąt");
    }

    private void save() {
        String u = url.getText().toString().trim();
        if (!u.isEmpty() && !u.contains("://")) u = "http://" + u;
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        Uri p = Uri.parse(u);
        boolean scheme = "http".equals(p.getScheme()) || "https".equals(p.getScheme());
        if (!scheme || p.getHost() == null || p.getHost().isEmpty()) {
            url.setError("Podaj adres, np. http://192.168.1.10:8123");
            return;
        }
        // Tylko serwer: ścieżka z przeglądarki nie jest potrzebna.
        String clean = p.getScheme() + "://" + p.getHost() + (p.getPort() > 0 ? ":" + p.getPort() : "");
        int s = shape.getCheckedRadioButtonId();
        int r = Math.max(0, rotation.getCheckedRadioButtonId() - 10);
        String n = name.getText().toString().trim();
        config.save(clean, n.isEmpty() ? "Panel" : n, s == 2 ? "square" : s == 3 ? "rect" : "auto", r * 90, css.isChecked());
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));
        finish();
    }

    private void forget() {
        new AlertDialog.Builder(this).setMessage("Usunąć zapisane logowanie? Panel trzeba będzie sparować od nowa.")
                .setPositiveButton("Usuń", (d, w) -> {
                    WebStorage.getInstance().deleteAllData();
                    CookieManager.getInstance().removeAllCookies(null);
                }).setNegativeButton("Anuluj", null).show();
    }

    private void open(String action) {
        try {
            startActivity(new Intent(action));
        } catch (ActivityNotFoundException | SecurityException e) {
            new AlertDialog.Builder(this).setMessage("Ten panel nie udostępnia tego ekranu. Użyj ADB, jak w instrukcji.").setPositiveButton("OK", null).show();
        }
    }

    // ---- wyszukiwanie HA (mDNS) ----

    private void discover() {
        nsd = getSystemService(NsdManager.class);
        if (nsd == null) return;
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
            @Override public void onStartDiscoveryFailed(String t, int e) { runOnUiThread(() -> searching.setText("Wpisz adres ręcznie")); }
            @Override public void onStopDiscoveryFailed(String t, int e) { }
        };
        try {
            nsd.discoverServices("_home-assistant._tcp", NsdManager.PROTOCOL_DNS_SD, listener);
        } catch (RuntimeException e) {
            Log.w(TAG, "mDNS", e);
            listener = null;
        }
        searching.postDelayed(() -> {
            if (seen.isEmpty()) searching.setText("Nie znaleziono. Wpisz adres ręcznie.");
        }, 10_000);
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
                    if (address != null) runOnUiThread(() -> add(s.getServiceName(), address));
                }
            });
        } catch (RuntimeException e) {
            Log.w(TAG, "resolve", e);
        }
    }

    private void add(String label, String address) {
        if (!seen.add(address)) return;
        searching.setVisibility(View.GONE);
        found.addView(button(label + "\n" + address, v -> url.setText(address)));
        if (url.getText().length() == 0) url.setText(address);
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

    // ---- widoki ----

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private TextView text(String s, int size) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(size);
        t.setPadding(0, dp(10), 0, dp(2));
        return t;
    }

    private EditText edit(String s, int type) {
        EditText e = new EditText(this);
        e.setText(s);
        e.setInputType(type);
        e.setSingleLine();
        return e;
    }

    private void radio(RadioGroup g, int id, String label, boolean checked) {
        RadioButton r = new RadioButton(this);
        r.setId(id);
        r.setText(label);
        r.setMinHeight(dp(44));
        g.addView(r);
        if (checked) g.check(id);
    }

    private Button button(String s, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setOnClickListener(l);
        b.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return b;
    }
}
