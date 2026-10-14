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
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/** Android 内部更新插件：清单、下载和安装都在原生层完成。 */
@CapacitorPlugin(name = "AndroidApkUpdater")
public class AndroidApkUpdaterPlugin extends Plugin {
    private static final String UPDATE_DIRECTORY = "updates";
    private static final String UPDATE_FILE = "ZhiWellCare-update.apk";
    private static final String PART_FILE = "ZhiWellCare-update.apk.part";
    private static final long DISK_RESERVE_BYTES = 16L * 1024 * 1024;
    private static final long INSTALL_TIMEOUT_MINUTES = 10;
    // 同一工作队列负责所有文件操作，清理不会与下载/安装写入竞争。
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService installWatchdog = Executors.newSingleThreadScheduledExecutor();
    private final Object stateLock = new Object();
    private boolean downloading;
    private boolean installing;
    private boolean destroyed;
    private long downloadGeneration;
    private UpdateHttpClient activeRequest;
    private DownloadedUpdate downloadedUpdate;
    private BroadcastReceiver installReceiver;
    private PluginCall installCall;
    private int installSessionId = -1;
    private ScheduledFuture<?> installDeadline;

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
            call.reject("无法读取当前应用版本。", "UPDATE_VERSION_READ_FAILED", error);
        }
    }

    @PluginMethod
    public void fetchUpdateManifest(PluginCall call) {
        String url = call.getString("url");
        if (!BuildConfig.UPDATE_MANIFEST_URL.equals(url)) {
            call.reject("更新清单地址与本构建配置不一致。", "UPDATE_MANIFEST_URL_INVALID");
            return;
        }
        enqueue(call, () -> {
            UpdateHttpClient client = httpClient();
            setActiveRequest(client);
            try {
                UpdateHttpClient.ManifestResponse response = client.fetchManifest(url);
                JSObject result = new JSObject();
                result.put("body", response.body);
                result.put("finalUrl", response.finalUrl);
                call.resolve(result);
            } finally {
                clearActiveRequest(client);
            }
        });
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
            call.reject("无法打开安装更新权限设置。", "UPDATE_INSTALL_PERMISSION_DENIED", error);
        }
    }

    @PluginMethod
    public void downloadApk(PluginCall call) {
        String url = call.getString("url");
        String sha256 = call.getString("sha256");
        String packageName = call.getString("expectedPackageName");
        Double versionValue = call.getDouble("expectedVersionCode");
        Double sizeValue = call.getDouble("expectedSizeBytes");
        if (url == null || sha256 == null || !sha256.matches("(?i)[0-9a-f]{64}")
                || !getContext().getPackageName().equals(packageName) || !positiveSafeInteger(versionValue)
                || !positiveSafeInteger(sizeValue) || sizeValue > UpdateHttpClient.MAX_APK_BYTES) {
            call.reject("APK 下载参数无效。", "UPDATE_DOWNLOAD_INVALID");
            return;
        }
        final long generation;
        final DownloadedUpdate candidate = new DownloadedUpdate(packageName, versionValue.longValue(),
                sizeValue.longValue(), sha256.toLowerCase(Locale.ROOT));
        synchronized (stateLock) {
            if (destroyed || downloading || installing) {
                call.reject("已有更新任务正在进行，请稍候。", "UPDATE_BUSY");
                return;
            }
            downloading = true;
            generation = ++downloadGeneration;
            downloadedUpdate = null;
        }
        enqueue(call, () -> {
            File part = null;
            File apk = null;
            UpdateHttpClient client = null;
            JSObject response = new JSObject();
            try {
                requireCurrentDownload(generation);
                part = updateFile(PART_FILE);
                apk = updateFile(UPDATE_FILE);
                client = httpClient();
                client.validateDownloadUrl(url);
                deleteQuietly(part);
                deleteQuietly(apk);
                // 预留缓存与系统安装副本的空间，不等文件写满磁盘后再报错。
                if (part.getParentFile().getUsableSpace() < candidate.sizeBytes * 2 + DISK_RESERVE_BYTES) {
                    throw new IllegalStateException("设备可用空间不足，请清理空间后重试。");
                }
                synchronized (stateLock) {
                    requireCurrentDownload(generation);
                    setActiveRequest(client);
                }
                UpdateHttpClient.DownloadResponse result;
                try (OutputStream output = new FileOutputStream(part)) {
                    result = client.download(url, output, candidate.sizeBytes, this::publishProgress);
                }
                requireCurrentDownload(generation);
                if (!constantTimeEquals(result.sha256, candidate.sha256)) throw new IllegalStateException("APK SHA-256 校验失败。");
                verifyArchive(part, candidate.packageName, candidate.versionCode);
                synchronized (stateLock) {
                    requireCurrentDownload(generation);
                    if (!part.renameTo(apk)) throw new IllegalStateException("无法保存已验证的更新文件。");
                    downloadedUpdate = candidate;
                }
                response.put("sizeBytes", result.sizeBytes);
                response.put("sha256", result.sha256);
            } catch (Exception error) {
                deleteQuietly(part);
                deleteQuietly(apk);
                synchronized (stateLock) { downloadedUpdate = null; }
                requireCurrentDownload(generation);
                throw error;
            } finally {
                clearActiveRequest(client);
                synchronized (stateLock) { downloading = false; }
            }
            // 先释放任务锁再回调，前端收到下载成功后可以立即发起安装。
            call.resolve(response);
        });
    }

    @PluginMethod
    public void installDownloadedApk(PluginCall call) {
        final DownloadedUpdate candidate;
        synchronized (stateLock) {
            if (destroyed || downloading || installing) {
                call.reject("已有更新任务正在进行，请稍候。", "UPDATE_BUSY");
                return;
            }
            candidate = downloadedUpdate;
            if (candidate == null) {
                call.reject("尚未下载可安装的更新文件。", "UPDATE_INSTALL_NOT_READY");
                return;
            }
            installing = true;
            installCall = call;
            call.setKeepAlive(true);
            // 厂商安装器漏发最终广播时，任务仍须有结束路径，不能永久占用安装锁。
            installDeadline = installWatchdog.schedule(() -> checkTimedOutInstall(call, candidate),
                    INSTALL_TIMEOUT_MINUTES, TimeUnit.MINUTES);
        }
        enqueue(call, () -> {
            try {
                File apk = updateFile(UPDATE_FILE);
                verifyDownloadedFile(apk, candidate);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    finishInstall(call, false, "请先允许 ZhiWellCare 安装应用更新。", "UPDATE_INSTALL_PERMISSION_DENIED");
                    return;
                }
                startInstallSession(apk, call);
            } catch (Exception error) {
                finishInstall(call, false, "无法启动系统安装器。", "UPDATE_INSTALL_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void clearDownloadedUpdate(PluginCall call) {
        synchronized (stateLock) {
            if (installing) {
                call.reject("系统安装确认尚未结束，请稍候。", "UPDATE_BUSY");
                return;
            }
            // 先取消网络，再排队删除；正在写入的 .part 不会被并发删除。
            ++downloadGeneration;
            downloadedUpdate = null;
            if (activeRequest != null) activeRequest.cancel();
        }
        enqueue(call, () -> {
            deleteQuietly(updateFile(PART_FILE));
            deleteQuietly(updateFile(UPDATE_FILE));
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        PluginCall pending;
        synchronized (stateLock) {
            if (destroyed) {
                super.handleOnDestroy();
                return;
            }
            destroyed = true;
            ++downloadGeneration;
            downloadedUpdate = null;
            if (activeRequest != null) activeRequest.cancel();
            pending = installCall;
        }
        if (pending != null) finishInstall(pending, false, "更新页面已关闭。", "UPDATE_CANCELLED");
        // shutdown 保留队列中的收尾任务，避免 shutdownNow 丢失 Promise 的结束回调。
        executor.execute(() -> {
            deleteQuietly(updateFile(PART_FILE));
            deleteQuietly(updateFile(UPDATE_FILE));
        });
        executor.shutdown();
        installWatchdog.shutdownNow();
        super.handleOnDestroy();
    }

    private void startInstallSession(File apk, PluginCall call) throws Exception {
        PackageInstaller installer = getContext().getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(getContext().getPackageName());
        params.setSize(apk.length());
        int sessionId = installer.createSession(params);
        synchronized (stateLock) {
            if (destroyed || installCall != call) {
                installer.abandonSession(sessionId);
                throw new UpdateHttpClient.CancelledException();
            }
            installSessionId = sessionId;
        }
        PackageInstaller.Session session;
        try {
            session = installer.openSession(sessionId);
        } catch (Exception error) {
            installer.abandonSession(sessionId);
            throw error;
        }
        InputStream input;
        try {
            input = new FileInputStream(apk);
        } catch (Exception error) {
            session.close();
            installer.abandonSession(sessionId);
            throw error;
        }
        UpdateInstallSession.writeAndCommit(input, apk.length(), new UpdateInstallSession.Session() {
            @Override public OutputStream openWrite(long size) throws Exception { return session.openWrite("base.apk", 0, size); }
            @Override public void fsync(OutputStream output) throws Exception { session.fsync(output); }
            @Override public void abandon() { installer.abandonSession(sessionId); }
            @Override public void close() { session.close(); }
            @Override public void commit() throws Exception {
                synchronized (stateLock) {
                    if (destroyed || installCall != call) throw new UpdateHttpClient.CancelledException();
                    // 随机动作名同时保护旧 Android 上的动态接收器免受猜测广播干扰。
                    String action = getContext().getPackageName() + ".UPDATE_INSTALL_STATUS." + sessionId + "." + UUID.randomUUID();
                    installReceiver = createInstallReceiver(call, sessionId);
                    registerInstallReceiver(action, installReceiver);
                    Intent intent = new Intent(action).setPackage(getContext().getPackageName());
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
                    PendingIntent status = PendingIntent.getBroadcast(getContext(), sessionId, intent, flags);
                    // 此时 APK 写入流已经关闭，最终结果由系统状态广播决定。
                    session.commit(status.getIntentSender());
                }
            }
        });
    }

    private void verifyDownloadedFile(File apk, DownloadedUpdate expected) throws Exception {
        if (!apk.isFile() || apk.length() != expected.sizeBytes) throw new IllegalStateException("待安装 APK 文件大小已改变，请重新下载。");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(apk)) {
            byte[] buffer = new byte[32 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                if (count > 0) digest.update(buffer, 0, count);
            }
        }
        if (!constantTimeEquals(UpdateHttpClient.hex(digest.digest()), expected.sha256)) {
            throw new IllegalStateException("待安装 APK 摘要已改变，请重新下载。");
        }
        verifyArchive(apk, expected.packageName, expected.versionCode);
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
        if (!signatureDigests(current).equals(signatureDigests(archive))) throw new IllegalStateException("APK 签名证书与当前应用不一致。");
    }

    private BroadcastReceiver createInstallReceiver(PluginCall call, int expectedSessionId) {
        return new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                // 会话标识和一次性任务引用共同防止旧回调结束新任务。
                synchronized (stateLock) {
                    if (installCall != call || intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1) != expectedSessionId) return;
                }
                int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    try {
                        Intent confirmation = readConfirmationIntent(intent);
                        if (confirmation == null) throw new IllegalStateException("系统未返回安装确认页面。");
                        confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(confirmation);
                    } catch (Exception error) {
                        finishInstall(call, false, "无法打开系统安装确认页面。", "UPDATE_INSTALL_FAILED", error);
                    }
                    return;
                }
                if (status == PackageInstaller.STATUS_SUCCESS) finishInstall(call, true, null, null);
                else if (status == PackageInstaller.STATUS_FAILURE_ABORTED
                        && !intent.hasExtra("android.content.pm.extra.DEVELOPER_VERIFICATION_FAILURE_REASON")) {
                    // 新系统的开发者验证拒绝也是 ABORTED，不能误显示为用户取消。
                    finishInstall(call, false, "已取消安装更新。", "UPDATE_INSTALL_CANCELLED");
                } else {
                    // 只公开系统状态码，避免把系统内部路径或完整错误消息传给日志。
                    finishInstall(call, false, "系统安装失败，状态码：" + status, "UPDATE_INSTALL_FAILED");
                }
            }
        };
    }

    private void finishInstall(PluginCall call, boolean success, String message, String code) {
        finishInstall(call, success, message, code, null);
    }

    private void checkTimedOutInstall(PluginCall call, DownloadedUpdate target) {
        synchronized (stateLock) { if (installCall != call) return; }
        try {
            // 可能只是回调丢失；先看真实已安装版本，再决定是否报失败。
            if (packageVersionCode(currentPackageInfo(0)) >= target.versionCode) {
                finishInstall(call, true, null, null);
                return;
            }
        } catch (Exception ignored) { /* 无法确认目标版本时走失败收尾，允许重新操作。 */ }
        finishInstall(call, false, "系统未在规定时间返回安装结果，请重试。", "UPDATE_INSTALL_FAILED");
    }

    private void finishInstall(PluginCall call, boolean success, String message, String code, Exception error) {
        BroadcastReceiver receiver;
        int sessionId;
        synchronized (stateLock) {
            if (installCall != call) return;
            installCall = null;
            if (installDeadline != null) installDeadline.cancel(false);
            installDeadline = null;
            receiver = installReceiver;
            installReceiver = null;
            sessionId = installSessionId;
            installSessionId = -1;
            if (success) {
                downloadedUpdate = null;
                // 清理先入队，再开放下一下载，避免删除新任务刚写好的文件。
                try {
                    executor.execute(() -> {
                        deleteQuietly(updateFile(PART_FILE));
                        deleteQuietly(updateFile(UPDATE_FILE));
                    });
                } catch (RejectedExecutionException ignored) {
                    // 销毁队列已安排缓存清理，仍须继续释放调用与安装锁。
                }
            }
            installing = false;
        }
        if (receiver != null) {
            try { getContext().unregisterReceiver(receiver); }
            catch (Exception ignored) { /* Activity 已移除 Receiver 时视为清理完成。 */ }
        }
        if (!success && sessionId >= 0) {
            try { getContext().getPackageManager().getPackageInstaller().abandonSession(sessionId); }
            catch (Exception ignored) { /* 系统已经结束的会话无须再次释放。 */ }
        }
        call.setKeepAlive(false);
        if (success) {
            JSObject result = new JSObject();
            result.put("status", "success");
            call.resolve(result);
        } else call.reject(message, code, error);
    }

    private UpdateHttpClient httpClient() throws Exception {
        return new UpdateHttpClient(BuildConfig.UPDATE_MANIFEST_URL, BuildConfig.UPDATE_DOWNLOAD_BASE_URL,
                BuildConfig.UPDATE_ALLOWED_DOWNLOAD_HOSTS);
    }

    private void setActiveRequest(UpdateHttpClient client) throws Exception {
        synchronized (stateLock) {
            if (destroyed) throw new UpdateHttpClient.CancelledException();
            activeRequest = client;
        }
    }

    private void clearActiveRequest(UpdateHttpClient client) {
        synchronized (stateLock) { if (activeRequest == client) activeRequest = null; }
    }

    private void requireCurrentDownload(long generation) throws Exception {
        synchronized (stateLock) {
            if (destroyed || generation != downloadGeneration) throw new UpdateHttpClient.CancelledException();
        }
    }

    private interface UpdateTask { void run() throws Exception; }

    private void enqueue(PluginCall call, UpdateTask task) {
        try {
            executor.execute(() -> {
                try { task.run(); }
                catch (Exception error) {
                    boolean cancelled;
                    synchronized (stateLock) { cancelled = destroyed; }
                    call.setKeepAlive(false);
                    String message = error.getMessage() == null ? "更新操作失败，请重试。" : error.getMessage();
                    call.reject(message, cancelled || error instanceof UpdateHttpClient.CancelledException
                            ? "UPDATE_CANCELLED" : "UPDATE_FAILED", error);
                }
            });
        } catch (RejectedExecutionException error) {
            synchronized (stateLock) {
                if (installCall == call) {
                    finishInstall(call, false, "更新页面已关闭。", "UPDATE_CANCELLED");
                    return;
                }
            }
            call.setKeepAlive(false);
            call.reject("更新页面已关闭。", "UPDATE_CANCELLED");
            synchronized (stateLock) { downloading = false; }
        }
    }

    @SuppressWarnings("deprecation")
    private Intent readConfirmationIntent(Intent source) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return source.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
        return source.getParcelableExtra(Intent.EXTRA_INTENT);
    }

    private void registerInstallReceiver(String action, BroadcastReceiver receiver) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(receiver, new IntentFilter(action), Context.RECEIVER_NOT_EXPORTED);
        } else getContext().registerReceiver(receiver, new IntentFilter(action));
    }

    private void publishProgress(long downloadedBytes, long totalBytes) {
        JSObject data = new JSObject();
        data.put("downloadedBytes", downloadedBytes);
        data.put("totalBytes", totalBytes);
        data.put("percent", Math.min(100, Math.round(downloadedBytes * 100f / totalBytes)));
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
        Signature[] signatures = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo != null
                ? info.signingInfo.getApkContentsSigners() : info.signatures;
        if (signatures == null || signatures.length == 0) throw new IllegalStateException("APK 不包含签名证书。");
        Set<String> result = new HashSet<>();
        for (Signature signature : signatures) result.add(UpdateHttpClient.hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));
        return result;
    }

    private static boolean positiveSafeInteger(Double value) {
        return value != null && Double.isFinite(value) && value > 0 && value <= 9_007_199_254_740_991d && Math.rint(value) == value;
    }

    private static boolean constantTimeEquals(String left, String right) {
        return MessageDigest.isEqual(left.getBytes(StandardCharsets.US_ASCII), right.getBytes(StandardCharsets.US_ASCII));
    }

    private static void deleteQuietly(File file) {
        if (file != null && file.exists()) file.delete();
    }

    /** 安装前保留并重新检查这次下载对应的候选身份，不能仅检查文件存在。 */
    private static final class DownloadedUpdate {
        final String packageName;
        final long versionCode;
        final long sizeBytes;
        final String sha256;
        DownloadedUpdate(String packageName, long versionCode, long sizeBytes, String sha256) {
            this.packageName = packageName;
            this.versionCode = versionCode;
            this.sizeBytes = sizeBytes;
            this.sha256 = sha256;
        }
    }
}
