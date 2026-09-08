package tj.kakapo.trade;

import android.content.Context;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Очередь и кэш кассы в файлах приложения (не SQLite, не кэш WebView).
 * Система не чистит filesDir — чеки не теряются за 3+ дня офлайна.
 */
final class KakapoFileStore {
  private static final int BINDER_SAFE = 160000;
  private final File dir;
  private final File queueFile;
  private String spillBuf = "";
  private String spillId = "";
  private final StringBuilder ingest = new StringBuilder();

  KakapoFileStore(Context ctx) {
    this.dir = new File(ctx.getFilesDir(), "kakapo-persist");
    if (!dir.exists()) dir.mkdirs();
    this.queueFile = new File(dir, "queue.json");
  }

  private File kvFile(String key) {
    String safe = String.valueOf(key).replaceAll("[^a-zA-Z0-9._-]", "_");
    if (safe.isEmpty()) safe = "_";
    return new File(dir, "kv-" + safe + ".json");
  }

  private String readUtf8(File f) {
    if (f == null || !f.exists()) return null;
    try {
      FileInputStream in = new FileInputStream(f);
      byte[] buf = new byte[(int) Math.max(0, f.length())];
      int n = in.read(buf);
      in.close();
      if (n <= 0) return null;
      return new String(buf, 0, n, StandardCharsets.UTF_8);
    } catch (Exception e) {
      return null;
    }
  }

  private boolean writeUtf8(File f, String text) {
    try {
      File tmp = new File(f.getAbsolutePath() + ".tmp");
      FileOutputStream out = new FileOutputStream(tmp);
      out.write((text == null ? "" : text).getBytes(StandardCharsets.UTF_8));
      out.flush();
      out.close();
      if (f.exists() && !f.delete()) {
        /* replace anyway */
      }
      return tmp.renameTo(f) || (f.exists() && f.length() > 0);
    } catch (Exception e) {
      return false;
    }
  }

  private String wrapMaybeSpill(String v) {
    if (v == null) return "null";
    if (v.length() <= BINDER_SAFE) return v;
    spillBuf = v;
    spillId = Long.toHexString(System.nanoTime());
    return "{\"__kakapoSpill\":\"" + spillId + "\",\"len\":" + v.length() + "}";
  }

  synchronized String spillSlice(String id, int off, int n) {
    if (id == null || !id.equals(spillId) || spillBuf == null) return "";
    if (off < 0 || n <= 0 || off >= spillBuf.length()) return "";
    int end = Math.min(spillBuf.length(), off + n);
    return spillBuf.substring(off, end);
  }

  synchronized boolean ingestBegin() {
    ingest.setLength(0);
    return true;
  }

  synchronized boolean ingestAppend(String chunk) {
    if (chunk != null) ingest.append(chunk);
    return true;
  }

  synchronized boolean ingestKvSet(String key) {
    String json = ingest.toString();
    ingest.setLength(0);
    return kvSet(key, json);
  }

  synchronized boolean ingestQueuePut() {
    String json = ingest.toString();
    ingest.setLength(0);
    return queuePut(json);
  }

  synchronized String kvGet(String key) {
    String raw = readUtf8(kvFile(key));
    if (raw == null || raw.isEmpty()) return "null";
    return wrapMaybeSpill(raw);
  }

  synchronized boolean kvSet(String key, String json) {
    if (key == null || key.isEmpty()) return false;
    return writeUtf8(kvFile(key), json == null ? "null" : json);
  }

  synchronized boolean kvDelete(String key) {
    File f = kvFile(key);
    return !f.exists() || f.delete();
  }

  synchronized String queueAll() {
    String raw = readUtf8(queueFile);
    if (raw == null || raw.trim().isEmpty()) return "[]";
    return wrapMaybeSpill(raw.trim());
  }

  synchronized boolean queuePut(String rowJson) {
    try {
      JSONObject row = new JSONObject(rowJson);
      String ref = row.optString("clientRef", "").trim();
      if (ref.isEmpty()) return false;
      JSONArray arr;
      String cur = readUtf8(queueFile);
      try {
        arr = (cur == null || cur.trim().isEmpty()) ? new JSONArray() : new JSONArray(cur);
      } catch (Exception e) {
        arr = new JSONArray();
      }
      JSONArray next = new JSONArray();
      for (int i = 0; i < arr.length(); i++) {
        JSONObject o = arr.optJSONObject(i);
        if (o == null) continue;
        if (ref.equals(o.optString("clientRef", "").trim())) continue;
        next.put(o);
      }
      next.put(row);
      return writeUtf8(queueFile, next.toString());
    } catch (Exception e) {
      return false;
    }
  }

  synchronized boolean queueDelete(String clientRef) {
    String ref = clientRef == null ? "" : clientRef.trim();
    if (ref.isEmpty()) return false;
    String cur = readUtf8(queueFile);
    if (cur == null) return true;
    try {
      JSONArray arr = new JSONArray(cur);
      JSONArray next = new JSONArray();
      for (int i = 0; i < arr.length(); i++) {
        JSONObject o = arr.optJSONObject(i);
        if (o == null) continue;
        if (ref.equals(o.optString("clientRef", "").trim())) continue;
        next.put(o);
      }
      return writeUtf8(queueFile, next.toString());
    } catch (Exception e) {
      return false;
    }
  }

  private File photoFile(String key) {
    String safe = String.valueOf(key).replaceAll("[^a-zA-Z0-9._-]", "_");
    if (safe.isEmpty()) safe = "_";
    File photos = new File(dir, "photos");
    if (!photos.exists()) photos.mkdirs();
    return new File(photos, safe + ".bin");
  }

  private File photoMetaFile(String key) {
    String safe = String.valueOf(key).replaceAll("[^a-zA-Z0-9._-]", "_");
    if (safe.isEmpty()) safe = "_";
    File photos = new File(dir, "photos");
    if (!photos.exists()) photos.mkdirs();
    return new File(photos, safe + ".meta");
  }

  /** mime\\nbase64 — для JS-моста; spill при большом размере */
  synchronized String photoGet(String key) {
    if (key == null || key.isEmpty()) return "null";
    try {
      File bin = photoFile(key);
      if (!bin.exists() || bin.length() < 32) return "null";
      byte[] buf = new byte[(int) bin.length()];
      FileInputStream in = new FileInputStream(bin);
      int n = in.read(buf);
      in.close();
      if (n < 32) return "null";
      String mime = "image/webp";
      String meta = readUtf8(photoMetaFile(key));
      if (meta != null && !meta.isEmpty()) {
        try {
          JSONObject o = new JSONObject(meta);
          String m = o.optString("mime", "");
          if (m != null && !m.isEmpty()) mime = m;
        } catch (Exception ignored) {}
      }
      String b64 = Base64.encodeToString(buf, 0, n, Base64.NO_WRAP);
      return wrapMaybeSpill(mime + "\n" + b64);
    } catch (Exception e) {
      return "null";
    }
  }

  synchronized boolean photoPut(String key, String base64, String mime) {
    if (key == null || key.isEmpty() || base64 == null || base64.isEmpty()) return false;
    try {
      byte[] raw = Base64.decode(base64, Base64.DEFAULT);
      if (raw == null || raw.length < 32) return false;
      File bin = photoFile(key);
      File tmp = new File(bin.getAbsolutePath() + ".tmp");
      FileOutputStream out = new FileOutputStream(tmp);
      out.write(raw);
      out.flush();
      out.close();
      if (bin.exists()) bin.delete();
      if (!tmp.renameTo(bin)) return false;
      JSONObject meta = new JSONObject();
      meta.put("mime", mime == null || mime.isEmpty() ? "image/webp" : mime);
      meta.put("at", System.currentTimeMillis());
      meta.put("bytes", raw.length);
      return writeUtf8(photoMetaFile(key), meta.toString());
    } catch (Exception e) {
      return false;
    }
  }

  /** Скачать URL нативно (без CORS WebView), вернуть mime\\nbase64 */
  synchronized String httpGetBase64(String urlStr) {
    if (urlStr == null || urlStr.trim().isEmpty()) return "null";
    HttpURLConnection conn = null;
    try {
      URL url = new URL(urlStr.trim());
      conn = (HttpURLConnection) url.openConnection();
      conn.setConnectTimeout(12000);
      conn.setReadTimeout(20000);
      conn.setInstanceFollowRedirects(true);
      conn.setRequestMethod("GET");
      conn.setRequestProperty("Accept", "image/*,*/*");
      int code = conn.getResponseCode();
      if (code < 200 || code >= 300) return "null";
      String mime = conn.getContentType();
      if (mime == null || mime.isEmpty()) mime = "image/webp";
      int semi = mime.indexOf(';');
      if (semi > 0) mime = mime.substring(0, semi).trim();
      InputStream in = conn.getInputStream();
      ByteArrayOutputStream bos = new ByteArrayOutputStream();
      byte[] buf = new byte[8192];
      int n;
      int total = 0;
      final int MAX = 2_500_000;
      while ((n = in.read(buf)) > 0) {
        total += n;
        if (total > MAX) {
          in.close();
          return "null";
        }
        bos.write(buf, 0, n);
      }
      in.close();
      byte[] raw = bos.toByteArray();
      if (raw.length < 32) return "null";
      String b64 = Base64.encodeToString(raw, Base64.NO_WRAP);
      return wrapMaybeSpill(mime + "\n" + b64);
    } catch (Exception e) {
      return "null";
    } finally {
      if (conn != null) conn.disconnect();
    }
  }
}
