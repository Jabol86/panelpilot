package pl.panelpilot.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;

/** Ustawienia urządzenia (to, co trzeba znać przed połączeniem z HA). */
final class Config {
    static final int TUNNEL_PORT = 18123;

    private final SharedPreferences prefs;
    private final Context context;

    Config(Context c) {
        context = c.getApplicationContext();
        prefs = context.getSharedPreferences("panelpilot", Context.MODE_PRIVATE);
    }

    String url() { return prefs.getString("url", ""); }
    String name() { return prefs.getString("name", "Panel"); }
    /** auto, square (NSPanel Pro 86) albo rect (NSPanel Pro 120). */
    String shape() { return prefs.getString("shape", "auto"); }
    int rotation() { return prefs.getInt("rotation", 0); }
    /** true: obraz obraca sama strona, gdy system nie pozwala obrócić ekranu. */
    boolean cssRotation() { return prefs.getBoolean("cssRotation", false); }

    void save(String url, String name, String shape, int rotation, boolean cssRotation) {
        prefs.edit().putString("url", url).putString("name", name).putString("shape", shape)
                .putInt("rotation", rotation).putBoolean("cssRotation", cssRotation).apply();
    }

    boolean secure() { return url().startsWith("https://"); }

    /** Przy http strona idzie przez tunel localhost, dzięki czemu przeglądarka udostępnia mikrofon. */
    String base() { return secure() ? url() : "http://localhost:" + TUNNEL_PORT; }

    String id() {
        String id = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
        return "app_" + (id == null ? "x" : id).replaceAll("[^A-Za-z0-9]", "");
    }

    static String model() { return (Build.MANUFACTURER + " " + Build.MODEL).trim(); }
}
