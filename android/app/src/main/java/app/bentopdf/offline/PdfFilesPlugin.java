package app.bentopdf.offline;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Moves PDFs between the app and the phone's storage, without the network:
 *
 *  - "openFile" event: a PDF opened with "Open with" or shared to the app.
 *  - save(): asks where to save (Android's own Save dialog), then writes.
 *
 * The app only ever sees files the user picked in one of those dialogs.
 */
@CapacitorPlugin(name = "PdfFiles")
public class PdfFilesPlugin extends Plugin {

    private static final long MAX_BYTES = 200L * 1024 * 1024;

    @Override
    public void load() {
        Activity activity = getActivity();
        if (activity != null) handleIntent(activity.getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = null;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = streamExtra(intent);
        }
        if (uri == null) return;

        // Handle each intent once, also across screen rotation.
        Activity activity = getActivity();
        if (activity != null) activity.setIntent(new Intent(Intent.ACTION_MAIN));

        try {
            JSObject file = new JSObject();
            file.put("name", displayName(uri));
            file.put("data", Base64.encodeToString(readAll(uri), Base64.NO_WRAP));
            // Kept until the page is ready to receive it.
            notifyListeners("openFile", file, true);
        } catch (Exception e) {
            JSObject error = new JSObject();
            error.put("message", e.getMessage() == null ? e.toString() : e.getMessage());
            notifyListeners("openFileError", error, true);
        }
    }

    @SuppressWarnings("deprecation")
    private Uri streamExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        Object extra = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return extra instanceof Uri ? (Uri) extra : null;
    }

    private byte[] readAll(Uri uri) throws Exception {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) throw new Exception("The file could not be opened.");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            long total = 0;
            int n;
            while ((n = in.read(buffer)) != -1) {
                total += n;
                if (total > MAX_BYTES) throw new Exception("The file is larger than 200 MB.");
                out.write(buffer, 0, n);
            }
            return out.toByteArray();
        }
    }

    private String displayName(Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
            } catch (Exception ignored) {
                // fall through to the path
            }
        }
        if (name == null) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "document.pdf";
        return name;
    }

    /** save({ name, data (base64), mimeType? }) -> { saved: boolean, name? } */
    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name", "document.pdf");
        String data = call.getString("data");
        if (data == null) {
            call.reject("No data to save.");
            return;
        }
        String mimeType = call.getString("mimeType", guessMimeType(name));
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "saveResult");
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject response = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            response.put("saved", false);
            call.resolve(response);
            return;
        }
        Uri target = data.getData();
        try (OutputStream out = getContext().getContentResolver().openOutputStream(target, "wt")) {
            if (out == null) throw new Exception("The location could not be written.");
            out.write(Base64.decode(call.getString("data"), Base64.DEFAULT));
            response.put("saved", true);
            response.put("name", displayName(target));
            call.resolve(response);
        } catch (Exception e) {
            call.reject("Could not save: " + e.getMessage());
        }
    }

    private static String guessMimeType(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".md")) return "text/markdown";
        return "application/octet-stream";
    }
}
