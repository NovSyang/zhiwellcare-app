package com.zhiwellcare.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Android 内部更新插件：下载和安装均留在 Native 层，Vue 无法访问 APK 文件路径。 */
@CapacitorPlugin(name = "AndroidApkUpdater")
public class AndroidApkUpdaterPlugin extends Plugin {
    private static final String UPDATE_DIRECTORY = "updates";
    private static final String UPDATE_FILE = "ZhiWellCare-update.apk";
    private static final String PART_FILE = "ZhiWellCare-update.apk.part";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private BroadcastReceiver installReceiver;

    @PluginMethod
    public void getCurrentVersion(PluginCall call) {
        try {
            PackageInfo info = currentPackageInfo(0);
            JSObject result = new JSObject();
            result.put("packageName", info.packageName);
            result.put("versionName", info.versionName == null ? "" : info.versionName);
            result.put("versionCode", packageVersionCode(info));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法读取当前应用版本。", error);
        }
    }

    @PluginMethod
    public void getInstallPermission(PluginCall call) {
        boolean required = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O;
        boolean granted = !required || getContext().getPackageManager().canRequestPackageInstalls();
        JSObject result = new JSObject();
        result.put("required", required);
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("无法打开安装更新权限设置。", error);
        }
    }

    @PluginMethod
    public void downloadApk(PluginCall call) {
        String url = call.getString("url");
        String expectedSha256 = call.getString("sha256");
        String expectedPackageName = call.getString("expectedPackageName");
        Integer expectedVersionCode = call.getInt("expectedVersionCode");
        Double expectedSizeValue = call.getDouble("expectedSizeBytes");
        long expectedSize = expectedSizeValue == null ? -1 : expectedSizeValue.longValue();

        if (url == null || !url.startsWith("https://") || expectedSha256 == null
                || expectedPackageName == null || expectedVersionCode == null) {
            call.reject("APK 下载参数无效。");
            return;
        }
        if (!downloading.compareAndSet(false, true)) {
            call.reject("已有更新正在下载，请稍候。");
            return;
        }

        executor.execute(() -> {
            File partFile = updateFile(PART_FILE);
            File finalFile = updateFile(UPDATE_FILE);
            deleteQuietly(partFile);
            deleteQuietly(finalFile);
            try {
                DownloadResult result = download(url, partFile);
                if (expectedSize > 0 && result.sizeBytes != expectedSize) {
                    throw new IllegalStateException("APK 文件大小与更新清单不一致。");
                }
                if (!constantTimeEquals(result.sha256, expectedSha256.toLowerCase(Locale.ROOT))) {
                    throw new IllegalStateException("APK SHA-256 校验失败。");
                }
                verifyArchive(partFile, expectedPackageName, expectedVersionCode.longValue());
                if (!partFile.renameTo(finalFile)) throw new IllegalStateException("无法保存已验证的更新文件。");

                JSObject response = new JSObject();
                response.put("sizeBytes", result.sizeBytes);
                response.put("sha256", result.sha256);
                call.resolve(response);
            } catch (Exception error) {
                deleteQuietly(partFile);
                deleteQuietly(finalFile);
                call.reject(error.getMessage() == null ? "APK 下载失败。" : error.getMessage(), error);
            } finally {
                downloading.set(false);
            }
        });
    }

    @PluginMethod
    public void installDownloadedApk(PluginCall call) {
        File apk = updateFile(UPDATE_FILE);
        if (!apk.isFile()) {
            call.reject("尚未下载可安装的更新文件。");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            call.reject("请先允许 ZhiWellCare 安装应用更新。");
            return;
        }
        if (installReceiver != null) {
            call.reject("安装流程已经启动。");
            return;
        }

        try {
            PackageInstaller installer = getContext().getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(getContext().getPackageName());
            int sessionId = installer.createSession(params);
            try (PackageInstaller.Session session = installer.openSession(sessionId);
                 InputStream input = new FileInputStream(apk);
                 OutputStream output = session.openWrite("base.apk", 0, apk.length())) {
                copy(input, output);
                session.fsync(output);

                String action = getContext().getPackageName() + ".UPDATE_INSTALL_STATUS." + sessionId;
                installReceiver = createInstallReceiver(call);
                registerInstallReceiver(action, installReceiver);
                Intent statusIntent = new Intent(action).setPackage(getContext().getPackageName());
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
                PendingIntent pendingIntent = PendingIntent.getBroadcast(getContext(), sessionId, statusIntent, flags);
                // 调用会保持到系统返回成功、失败或需要用户确认的最终结果。
                call.setKeepAlive(true);
                session.commit(pendingIntent.getIntentSender());
            }
        } catch (Exception error) {
            clearInstallReceiver();
            call.reject("无法启动系统安装器。", error);
        }
    }

    @PluginMethod
    public void clearDownloadedUpdate(PluginCall call) {
        deleteQuietly(updateFile(PART_FILE));
        deleteQuietly(updateFile(UPDATE_FILE));
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        clearInstallReceiver();
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private DownloadResult download(String source, File destination) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(source).openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream");
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("更新服务器返回 HTTP " + status + "。");
            // GitHub 可跳转到资产 CDN，但最终地址仍必须使用 HTTPS，禁止降级下载。
            if (!"https".equalsIgnoreCase(connection.getURL().getProtocol())) {
                throw new IllegalStateException("更新下载地址必须使用 HTTPS。");
            }
            long totalBytes = connection.getContentLengthLong();
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long downloadedBytes = 0;
            long lastProgressAt = 0;
            try (InputStream input = connection.getInputStream(); OutputStream output = new FileOutputStream(destination)) {
                byte[] buffer = new byte[32 * 1024];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (count == 0) continue;
                    output.write(buffer, 0, count);
                    digest.update(buffer, 0, count);
                    downloadedBytes += count;
                    long now = System.currentTimeMillis();
                    if (now - lastProgressAt >= 200) {
                        publishProgress(downloadedBytes, totalBytes);
                        lastProgressAt = now;
                    }
                }
            }
            publishProgress(downloadedBytes, totalBytes);
            return new DownloadResult(downloadedBytes, toHex(digest.digest()));
        } finally {
            connection.disconnect();
        }
    }

    private void verifyArchive(File apk, String expectedPackageName, long expectedVersionCode) throws Exception {
        PackageManager manager = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (archive == null) throw new IllegalStateException("下载文件不是有效 APK。");
        if (!expectedPackageName.equals(archive.packageName)) throw new IllegalStateException("APK 包名不匹配。");
        if (packageVersionCode(archive) != expectedVersionCode) throw new IllegalStateException("APK versionCode 与更新清单不一致。");

        PackageInfo current = currentPackageInfo(flags);
        if (expectedVersionCode <= packageVersionCode(current)) throw new IllegalStateException("APK 版本必须高于当前版本。");
        if (!signatureDigests(current).equals(signatureDigests(archive))) {
            throw new IllegalStateException("APK 签名证书与当前应用不一致。");
        }
    }

    private BroadcastReceiver createInstallReceiver(PluginCall call) {
        return new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    Intent confirmation = readConfirmationIntent(intent);
                    if (confirmation == null) {
                        finishInstallCall(call, false, "系统未返回安装确认页面。");
                        return;
                    }
                    confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(confirmation);
                    return;
                }
                if (status == PackageInstaller.STATUS_SUCCESS) finishInstallCall(call, true, null);
                else finishInstallCall(call, false, message == null ? "系统安装失败，状态码：" + status : message);
            }
        };
    }

    private void finishInstallCall(PluginCall call, boolean success, String message) {
        clearInstallReceiver();
        call.setKeepAlive(false);
        if (success) {
            JSObject result = new JSObject();
            result.put("status", "success");
            call.resolve(result);
        } else call.reject(message);
    }

    @SuppressWarnings("deprecation")
    private Intent readConfirmationIntent(Intent source) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return source.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
        }
        return source.getParcelableExtra(Intent.EXTRA_INTENT);
    }

    private void registerInstallReceiver(String action, BroadcastReceiver receiver) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(receiver, new IntentFilter(action), Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(receiver, new IntentFilter(action));
        }
    }

    private void clearInstallReceiver() {
        BroadcastReceiver receiver = installReceiver;
        installReceiver = null;
        if (receiver == null) return;
        try {
            getContext().unregisterReceiver(receiver);
        } catch (Exception ignored) {
            // Activity 已销毁或 Receiver 已被系统移除时按清理完成处理。
        }
    }

    private void publishProgress(long downloadedBytes, long totalBytes) {
        JSObject data = new JSObject();
        data.put("downloadedBytes", downloadedBytes);
        data.put("totalBytes", totalBytes > 0 ? totalBytes : null);
        data.put("percent", totalBytes > 0 ? Math.min(100, Math.round(downloadedBytes * 100f / totalBytes)) : null);
        notifyListeners("updateDownloadProgress", data);
    }

    private File updateFile(String name) {
        File directory = new File(getContext().getCacheDir(), UPDATE_DIRECTORY);
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("无法创建更新缓存目录。");
        return new File(directory, name);
    }

    private PackageInfo currentPackageInfo(int flags) throws PackageManager.NameNotFoundException {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), flags);
    }

    @SuppressWarnings("deprecation")
    private long packageVersionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    @SuppressWarnings("deprecation")
    private Set<String> signatureDigests(PackageInfo info) throws Exception {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo != null) {
            signatures = info.signingInfo.getApkContentsSigners();
        } else {
            signatures = info.signatures;
        }
        if (signatures == null || signatures.length == 0) throw new IllegalStateException("APK 不包含签名证书。");
        Set<String> result = new HashSet<>();
        for (Signature signature : signatures) {
            result.add(toHex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));
        }
        return result;
    }

    private static void copy(InputStream input, OutputStream output) throws Exception {
        byte[] buffer = new byte[32 * 1024];
        int count;
        while ((count = input.read(buffer)) >= 0) {
            if (count > 0) output.write(buffer, 0, count);
        }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) value.append(String.format(Locale.ROOT, "%02x", item & 0xff));
        return value.toString();
    }

    private static boolean constantTimeEquals(String left, String right) {
        return MessageDigest.isEqual(left.getBytes(), right.getBytes());
    }

    private static void deleteQuietly(File file) {
        if (file.exists()) file.delete();
    }

    private static class DownloadResult {
        final long sizeBytes;
        final String sha256;

        DownloadResult(long sizeBytes, String sha256) {
            this.sizeBytes = sizeBytes;
            this.sha256 = sha256;
        }
    }
}
