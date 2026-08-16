package tj.kakapo.trade;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Локальная касса Android — тот же набор таблиц, что SQLite на ПК. */
final class KakapoSqliteStore extends SQLiteOpenHelper {
  private static final String DB_NAME = "kakapo-local.db";
  private static final int DB_VER = 1;
  private final File legacyQueue;

  KakapoSqliteStore(Context ctx) {
    super(ctx, DB_NAME, null, DB_VER);
    this.legacyQueue = new File(ctx.getFilesDir(), "kakapo-queue.json");
    getWritableDatabase();
    migrateLegacyQueue();
  }

  @Override
  public void onCreate(SQLiteDatabase db) {
    db.execSQL("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)");
    db.execSQL("CREATE TABLE IF NOT EXISTS queue (client_ref TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)");
    db.execSQL("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)");
    db.execSQL("CREATE TABLE IF NOT EXISTS mirror (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(kind, id))");
    db.execSQL("CREATE TABLE IF NOT EXISTS entities (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(kind, id))");
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_entities_kind_updated ON entities(kind, updated_at)");
  }

  @Override
  public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}

  private synchronized void migrateLegacyQueue() {
    if (!legacyQueue.exists()) return;
    try {
      FileInputStream in = new FileInputStream(legacyQueue);
      byte[] buf = new byte[(int) Math.max(0, legacyQueue.length())];
      int n = in.read(buf);
      in.close();
      if (n <= 0) {
        legacyQueue.delete();
        return;
      }
      JSONArray arr = new JSONArray(new String(buf, 0, n, StandardCharsets.UTF_8));
      for (int i = 0; i < arr.length(); i++) {
        JSONObject row = arr.optJSONObject(i);
        if (row != null) queuePut(row.toString());
      }
      File bak = new File(legacyQueue.getAbsolutePath() + ".migrated");
      if (!legacyQueue.renameTo(bak)) legacyQueue.delete();
    } catch (Exception ignored) {}
  }

  synchronized String kvGet(String key) {
    if (key == null || key.isEmpty()) return "null";
    SQLiteDatabase db = getReadableDatabase();
    Cursor c = db.rawQuery("SELECT value FROM kv WHERE key = ?", new String[] { key });
    try {
      if (!c.moveToFirst()) return "null";
      String v = c.getString(0);
      return v == null || v.isEmpty() ? "null" : v;
    } finally {
      c.close();
    }
  }

  synchronized boolean kvSet(String key, String json) {
    if (key == null || key.isEmpty()) return false;
    String val = json == null ? "null" : json;
    getWritableDatabase().execSQL(
      "INSERT OR REPLACE INTO kv(key, value) VALUES(?, ?)",
      new Object[] { key, val }
    );
    return true;
  }

  synchronized boolean kvDelete(String key) {
    if (key == null || key.isEmpty()) return false;
    getWritableDatabase().execSQL("DELETE FROM kv WHERE key = ?", new Object[] { key });
    return true;
  }

  synchronized String queueAll() {
    JSONArray out = new JSONArray();
    Cursor c = getReadableDatabase().rawQuery(
      "SELECT payload FROM queue ORDER BY updated_at ASC, client_ref ASC",
      null
    );
    try {
      while (c.moveToNext()) {
        try {
          out.put(new JSONObject(c.getString(0)));
        } catch (Exception ignored) {}
      }
    } finally {
      c.close();
    }
    return out.toString();
  }

  synchronized boolean queuePut(String rowJson) {
    try {
      JSONObject row = new JSONObject(rowJson);
      String ref = row.optString("clientRef", "").trim();
      if (ref.isEmpty()) return false;
      String stamp = isoNow();
      getWritableDatabase().execSQL(
        "INSERT OR REPLACE INTO queue(client_ref, payload, updated_at) VALUES(?, ?, ?)",
        new Object[] { ref, row.toString(), stamp }
      );
      return true;
    } catch (Exception e) {
      return false;
    }
  }

  synchronized boolean queueDelete(String clientRef) {
    if (clientRef == null || clientRef.trim().isEmpty()) return false;
    getWritableDatabase().execSQL(
      "DELETE FROM queue WHERE client_ref = ?",
      new Object[] { clientRef.trim() }
    );
    return true;
  }

  synchronized String metaGet() {
    JSONObject meta = new JSONObject();
    Cursor c = getReadableDatabase().rawQuery("SELECT key, value FROM meta", null);
    try {
      while (c.moveToNext()) {
        String k = c.getString(0);
        String raw = c.getString(1);
        try {
          meta.put(k, new JSONTokener(raw == null ? "null" : raw).nextValue());
        } catch (Exception e) {
          try { meta.put(k, raw); } catch (Exception ignored) {}
        }
      }
    } finally {
      c.close();
    }
    return meta.toString();
  }

  synchronized boolean metaPatch(String patchJson) {
    try {
      JSONObject patch = new JSONObject(patchJson == null ? "{}" : patchJson);
      JSONArray names = patch.names();
      if (names == null) return true;
      SQLiteDatabase db = getWritableDatabase();
      db.beginTransaction();
      try {
        for (int i = 0; i < names.length(); i++) {
          String k = names.getString(i);
          Object v = patch.get(k);
          String stored;
          if (v instanceof JSONObject || v instanceof JSONArray) stored = v.toString();
          else if (v instanceof String) stored = JSONObject.quote((String) v);
          else stored = String.valueOf(v);
          db.execSQL("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)", new Object[] { k, stored });
        }
        db.setTransactionSuccessful();
      } finally {
        db.endTransaction();
      }
      return true;
    } catch (Exception e) {
      return false;
    }
  }

  synchronized boolean markInstalled() {
    return metaPatch("{\"bootstrapComplete\":true,\"installComplete\":true}");
  }

  synchronized boolean mirrorPut(String json) {
    try {
      JSONObject row = new JSONObject(json);
      String kind = row.optString("kind", "").trim();
      String id = row.optString("id", "").trim();
      if (kind.isEmpty() || id.isEmpty()) return false;
      Object data = row.opt("data");
      String payload = data == null || data == JSONObject.NULL ? "null" : data.toString();
      if (data instanceof String) payload = JSONObject.quote((String) data);
      String stamp = isoNow();
      getWritableDatabase().execSQL(
        "INSERT OR REPLACE INTO mirror(kind, id, payload, updated_at) VALUES(?, ?, ?, ?)",
        new Object[] { kind, id, payload, stamp }
      );
      return true;
    } catch (Exception e) {
      return false;
    }
  }

  synchronized String mirrorGet(String kind, String id) {
    Cursor c = getReadableDatabase().rawQuery(
      "SELECT payload FROM mirror WHERE kind = ? AND id = ?",
      new String[] { String.valueOf(kind), String.valueOf(id) }
    );
    try {
      if (!c.moveToFirst()) return "null";
      String p = c.getString(0);
      return p == null || p.isEmpty() ? "null" : p;
    } finally {
      c.close();
    }
  }

  synchronized String mirrorList(String kind, int limit) {
    int lim = Math.max(1, Math.min(2000, limit <= 0 ? 200 : limit));
    JSONArray out = new JSONArray();
    Cursor c;
    if (kind != null && !kind.isEmpty()) {
      c = getReadableDatabase().rawQuery(
        "SELECT kind, id, payload, updated_at FROM mirror WHERE kind = ? ORDER BY updated_at DESC LIMIT ?",
        new String[] { kind, String.valueOf(lim) }
      );
    } else {
      c = getReadableDatabase().rawQuery(
        "SELECT kind, id, payload, updated_at FROM mirror ORDER BY updated_at DESC LIMIT ?",
        new String[] { String.valueOf(lim) }
      );
    }
    try {
      while (c.moveToNext()) {
        try {
          JSONObject o = new JSONObject();
          o.put("kind", c.getString(0));
          o.put("id", c.getString(1));
          String payload = c.getString(2);
          try { o.put("data", new JSONObject(payload)); }
          catch (Exception e) {
            try { o.put("data", new JSONArray(payload)); }
            catch (Exception e2) { o.put("data", payload); }
          }
          o.put("updatedAtIso", c.getString(3));
          out.put(o);
        } catch (Exception ignored) {}
      }
    } finally {
      c.close();
    }
    return out.toString();
  }

  synchronized boolean entityPut(String json) {
    try {
      JSONObject row = new JSONObject(json);
      return entityPutRow(row);
    } catch (Exception e) {
      return false;
    }
  }

  private boolean entityPutRow(JSONObject row) {
    String kind = row.optString("kind", "").trim();
    String id = row.optString("id", "").trim();
    if (kind.isEmpty() || id.isEmpty()) return false;
    String stamp = row.optString("updatedAtIso", row.optString("updatedAt", isoNow()));
    if (stamp.isEmpty()) stamp = isoNow();
    int del = row.optBoolean("deleted", false) ? 1 : 0;
    Object data = row.opt("data");
    String payload = data == null || data == JSONObject.NULL ? "null" : String.valueOf(data);
    if (data instanceof JSONObject || data instanceof JSONArray) payload = data.toString();
    else if (data instanceof String) payload = JSONObject.quote((String) data);
    getWritableDatabase().execSQL(
      "INSERT OR REPLACE INTO entities(kind, id, payload, updated_at, deleted) VALUES(?, ?, ?, ?, ?)",
      new Object[] { kind, id, payload, stamp, del }
    );
    return true;
  }

  synchronized boolean entityPutMany(String jsonArray) {
    try {
      JSONArray arr = new JSONArray(jsonArray == null ? "[]" : jsonArray);
      SQLiteDatabase db = getWritableDatabase();
      db.beginTransaction();
      try {
        for (int i = 0; i < arr.length(); i++) {
          JSONObject row = arr.optJSONObject(i);
          if (row != null) entityPutRow(row);
        }
        db.setTransactionSuccessful();
      } finally {
        db.endTransaction();
      }
      return true;
    } catch (Exception e) {
      return false;
    }
  }

  synchronized String entityGet(String kind, String id) {
    Cursor c = getReadableDatabase().rawQuery(
      "SELECT payload, updated_at, deleted FROM entities WHERE kind = ? AND id = ?",
      new String[] { String.valueOf(kind), String.valueOf(id) }
    );
    try {
      if (!c.moveToFirst()) return "null";
      if (c.getInt(2) != 0) return "null";
      JSONObject o = new JSONObject();
      String payload = c.getString(0);
      try { o.put("data", new JSONObject(payload)); }
      catch (Exception e) {
        try { o.put("data", new JSONArray(payload)); }
        catch (Exception e2) {
          try { o.put("data", JSONObject.NULL); } catch (Exception ignored) {}
        }
      }
      o.put("updatedAtIso", c.getString(1));
      return o.toString();
    } catch (Exception e) {
      return "null";
    } finally {
      c.close();
    }
  }

  synchronized String entityList(String kind, String optsJson) {
    JSONArray out = new JSONArray();
    try {
      JSONObject opts = new JSONObject(optsJson == null || optsJson.isEmpty() ? "{}" : optsJson);
      int lim = Math.max(1, Math.min(50000, opts.optInt("limit", 20000)));
      String since = opts.optString("since", "");
      boolean includeDeleted = opts.optBoolean("includeDeleted", false);
      Cursor c;
      boolean hasKind = kind != null && !kind.isEmpty();
      if (hasKind && !since.isEmpty()) {
        c = getReadableDatabase().rawQuery(
          "SELECT kind, id, payload, updated_at, deleted FROM entities WHERE kind = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT ?",
          new String[] { kind, since, String.valueOf(lim) }
        );
      } else if (hasKind) {
        c = getReadableDatabase().rawQuery(
          includeDeleted
            ? "SELECT kind, id, payload, updated_at, deleted FROM entities WHERE kind = ? ORDER BY updated_at ASC LIMIT ?"
            : "SELECT kind, id, payload, updated_at, deleted FROM entities WHERE kind = ? AND deleted = 0 ORDER BY updated_at ASC LIMIT ?",
          new String[] { kind, String.valueOf(lim) }
        );
      } else if (!since.isEmpty()) {
        c = getReadableDatabase().rawQuery(
          "SELECT kind, id, payload, updated_at, deleted FROM entities WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?",
          new String[] { since, String.valueOf(lim) }
        );
      } else {
        c = getReadableDatabase().rawQuery(
          includeDeleted
            ? "SELECT kind, id, payload, updated_at, deleted FROM entities ORDER BY updated_at ASC LIMIT ?"
            : "SELECT kind, id, payload, updated_at, deleted FROM entities WHERE deleted = 0 ORDER BY updated_at ASC LIMIT ?",
          new String[] { String.valueOf(lim) }
        );
      }
      try {
        while (c.moveToNext()) {
          JSONObject o = new JSONObject();
          o.put("kind", c.getString(0));
          o.put("id", c.getString(1));
          String payload = c.getString(2);
          try { o.put("data", new JSONObject(payload)); }
          catch (Exception e) {
            try { o.put("data", new JSONArray(payload)); }
            catch (Exception e2) { o.put("data", JSONObject.NULL); }
          }
          o.put("updatedAtIso", c.getString(3));
          o.put("deleted", c.getInt(4) != 0);
          out.put(o);
        }
      } finally {
        c.close();
      }
    } catch (Exception ignored) {}
    return out.toString();
  }

  synchronized boolean entityDelete(String kind, String id) {
    getWritableDatabase().execSQL(
      "DELETE FROM entities WHERE kind = ? AND id = ?",
      new Object[] { String.valueOf(kind), String.valueOf(id) }
    );
    return true;
  }

  private static String isoNow() {
    java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
    f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
    return f.format(new java.util.Date());
  }
}
