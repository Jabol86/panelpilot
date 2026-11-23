package pl.panelpilot.app;

import android.util.Log;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;

/**
 * Przekazuje połączenia z localhost na adres Home Assistanta (zwykłe TCP, bez zmiany treści).
 * Strona z localhost jest dla WebView „bezpieczna”, więc działa mikrofon w domofonie.
 * Nasłuchuje wyłącznie na pętli zwrotnej: z sieci nie da się z niego skorzystać.
 */
final class Tunnel {
    private static final String TAG = "Tunnel";
    private final String host;
    private final int port;
    private volatile ServerSocket server;
    private volatile boolean stopped;

    Tunnel(String host, int port) {
        this.host = host;
        this.port = port;
    }

    /** Gniazdo otwierane od razu, zanim WebView zacznie ładować stronę. */
    void start(int localPort) throws IOException {
        ServerSocket s = new ServerSocket();
        s.setReuseAddress(true);
        s.bind(new InetSocketAddress(InetAddress.getByAddress(new byte[]{127, 0, 0, 1}), localPort), 50);
        server = s;
        thread("accept", () -> {
            while (!stopped) {
                try {
                    Socket in = s.accept();
                    thread("connect", () -> connect(in));
                } catch (IOException e) {
                    if (!stopped) Log.w(TAG, "accept: " + e.getMessage());
                }
            }
        });
    }

    void stop() {
        stopped = true;
        close(server);
    }

    private void connect(Socket in) {
        Socket out = new Socket();
        try {
            out.connect(new InetSocketAddress(host, port), 6000);
            in.setTcpNoDelay(true);
            out.setTcpNoDelay(true);
            out.setKeepAlive(true);
            thread("up", () -> pump(in, out));
            pump(out, in);
        } catch (IOException e) {
            Log.w(TAG, "HA niedostępny: " + e.getMessage());
            close(in);
            close(out);
        }
    }

    private static void pump(Socket from, Socket to) {
        byte[] buf = new byte[16 * 1024];
        try {
            InputStream is = from.getInputStream();
            OutputStream os = to.getOutputStream();
            int n;
            while ((n = is.read(buf)) >= 0) {
                os.write(buf, 0, n);
                os.flush();
            }
            // Koniec jednego kierunku: druga strona może jeszcze nadawać.
            to.shutdownOutput();
        } catch (IOException e) {
            close(from);
            close(to);
            return;
        }
        if (from.isOutputShutdown() || to.isInputShutdown()) {
            close(from);
            close(to);
        }
    }

    private static void thread(String name, Runnable r) {
        Thread t = new Thread(r, "tunnel-" + name);
        t.setDaemon(true);
        t.start();
    }

    private static void close(java.io.Closeable c) {
        if (c == null) return;
        try {
            c.close();
        } catch (IOException ignored) {
            // zamykanie
        }
    }
}
