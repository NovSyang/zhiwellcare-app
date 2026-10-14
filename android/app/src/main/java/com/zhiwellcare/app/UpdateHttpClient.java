package com.zhiwellcare.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;

/** 更新专用 HTTP 客户端：每一跳都检查地址、时间和大小，不继承业务认证头。 */
final class UpdateHttpClient {
    static final long MAX_MANIFEST_BYTES = 1024L * 1024;
    static final long MAX_APK_BYTES = 1024L * 1024 * 1024;
    private static final long MANIFEST_TIMEOUT_MS = 30_000;
    private static final long APK_TIMEOUT_MS = 15 * 60_000;
    private static final int MAX_REDIRECTS = 5;
    private static final ScheduledExecutorService DEADLINES = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "update-http-deadline");
        thread.setDaemon(true);
        return thread;
    });
    private final URI manifestUri;
    private final URI downloadBaseUri;
    private final Set<String> allowedHosts = new HashSet<>();
    private final ConnectionFactory connections;
    private final Clock clock;
    private final long manifestTimeoutMillis;
    private final long apkTimeoutMillis;
    private volatile boolean cancelled;
    private volatile boolean timedOut;
    private volatile HttpURLConnection activeConnection;

    interface ConnectionFactory {
        HttpURLConnection open(URL url) throws IOException;
    }

    interface Clock {
        long nowMillis();
    }

    interface Progress {
        void update(long downloadedBytes, long totalBytes);
    }

    UpdateHttpClient(String manifestUrl, String downloadBaseUrl, String approvedHosts) throws Exception {
        this(manifestUrl, downloadBaseUrl, approvedHosts,
                url -> (HttpURLConnection) url.openConnection(),
                () -> TimeUnit.NANOSECONDS.toMillis(System.nanoTime()));
    }

    // 注入连接和时钟后，本机测试可以覆盖异常网络而无需访问公网。
    UpdateHttpClient(String manifestUrl, String downloadBaseUrl, String approvedHosts,
                     ConnectionFactory connections, Clock clock) throws Exception {
        this(manifestUrl, downloadBaseUrl, approvedHosts, connections, clock, MANIFEST_TIMEOUT_MS, APK_TIMEOUT_MS);
    }

    // 测试可缩短总时限，实际构建仍固定使用 30 秒清单和 15 分钟 APK 的上限。
    UpdateHttpClient(String manifestUrl, String downloadBaseUrl, String approvedHosts,
                     ConnectionFactory connections, Clock clock, long manifestTimeoutMillis, long apkTimeoutMillis) throws Exception {
        manifestUri = secureUri(manifestUrl);
        downloadBaseUri = secureUri(downloadBaseUrl);
        for (String host : approvedHosts.split(",")) {
            String normalized = host.trim().toLowerCase(Locale.ROOT);
            if (!normalized.matches("[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?")) {
                throw new IOException("更新下载主机配置无效。");
            }
            allowedHosts.add(normalized);
        }
        if (!allowedHosts.contains(manifestUri.getHost().toLowerCase(Locale.ROOT))
                || !allowedHosts.contains(downloadBaseUri.getHost().toLowerCase(Locale.ROOT))) {
            throw new IOException("更新入口主机不在允许列表内。");
        }
        this.connections = connections;
        this.clock = clock;
        this.manifestTimeoutMillis = manifestTimeoutMillis;
        this.apkTimeoutMillis = apkTimeoutMillis;
    }

    ManifestResponse fetchManifest(String source) throws Exception {
        // 精确比对构建入口，避免把原生桥接变成任意网站的代理。
        if (!manifestUri.toString().equals(source)) throw new IOException("更新清单地址与本构建配置不一致。");
        try (UpdateCookieIsolation.Scope cookieScope = UpdateCookieIsolation.begin();
             Deadline requestDeadline = armDeadline(manifestTimeoutMillis)) {
            return fetchAnonymousManifest(source);
        }
    }

    private ManifestResponse fetchAnonymousManifest(String source) throws Exception {
        long deadline = clock.nowMillis() + manifestTimeoutMillis;
        OpenResponse opened = open(source, deadline, "application/json, text/plain");
        try {
            long length = opened.connection.getContentLengthLong();
            if (length > MAX_MANIFEST_BYTES) throw new RequestException("更新清单超过 1 MiB 上限。");
            String contentType = opened.connection.getContentType();
            if (contentType != null && contentType.toLowerCase(Locale.ROOT).contains("text/html")) {
                throw new RequestException("更新服务器返回网页，请检查公开清单或登录限制。");
            }
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            transfer(opened.connection, body, MAX_MANIFEST_BYTES, deadline, null, null);
            String text = new String(body.toByteArray(), StandardCharsets.UTF_8);
            if (text.startsWith("\uFEFF")) text = text.substring(1);
            if (!text.trim().startsWith("{")) throw new RequestException("更新服务器未返回 JSON 清单。");
            checkDeadline(deadline);
            return new ManifestResponse(text, opened.finalUrl);
        } finally {
            close(opened.connection);
        }
    }

    DownloadResponse download(String source, OutputStream destination, long expectedSize,
                              Progress progress) throws Exception {
        validateDownloadUrl(source);
        if (expectedSize <= 0 || expectedSize > MAX_APK_BYTES) throw new IOException("APK 预期大小超出允许范围。");
        try (UpdateCookieIsolation.Scope cookieScope = UpdateCookieIsolation.begin();
             Deadline requestDeadline = armDeadline(apkTimeoutMillis)) {
            return downloadAnonymous(source, destination, expectedSize, progress);
        }
    }

    private DownloadResponse downloadAnonymous(String source, OutputStream destination, long expectedSize,
                                               Progress progress) throws Exception {
        long deadline = clock.nowMillis() + apkTimeoutMillis;
        OpenResponse opened = open(source, deadline, "application/vnd.android.package-archive, application/octet-stream");
        try {
            long length = opened.connection.getContentLengthLong();
            if (length >= 0 && length != expectedSize) throw new RequestException("APK 响应大小与清单不一致。");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long copied = transfer(opened.connection, destination, expectedSize, deadline, digest, progress);
            if (copied != expectedSize) throw new RequestException("APK 文件大小与更新清单不一致。");
            return new DownloadResponse(copied, hex(digest.digest()));
        } finally {
            close(opened.connection);
        }
    }

    void validateDownloadUrl(String source) throws Exception {
        URI uri = secureUri(source);
        requireApprovedHost(uri);
        if (uri.getHost().equalsIgnoreCase(downloadBaseUri.getHost())) {
            String basePath = downloadBaseUri.getPath().replaceAll("/+$", "");
            // Gitee 初始附件必须来自本仓库；明确批准的其它主机只用于受控 CDN。
            if (!uri.normalize().getPath().startsWith(basePath + "/")) {
                throw new IOException("APK 地址不属于配置的发布仓库。");
            }
        }
    }

    void cancel() {
        cancelled = true;
        HttpURLConnection connection = activeConnection;
        if (connection != null) connection.disconnect();
    }

    private OpenResponse open(String source, long deadline, String accept) throws Exception {
        URI uri = secureUri(source);
        Set<String> visited = new HashSet<>();
        for (int redirects = 0; ; redirects++) {
            requireApprovedHost(uri);
            checkDeadline(deadline);
            if (!visited.add(uri.normalize().toString())) throw new RequestException("更新地址存在重定向循环。");
            HttpURLConnection connection;
            try { connection = connections.open(uri.toURL()); }
            catch (IOException error) { throw new RequestException("无法连接 HTTPS 更新服务器。"); }
            activeConnection = connection;
            try {
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(timeout(deadline, 15_000));
                connection.setReadTimeout(timeout(deadline, 30_000));
                connection.setUseCaches(false);
                connection.setAllowUserInteraction(false);
                connection.setRequestProperty("Accept", accept);
                connection.setRequestProperty("Accept-Encoding", "identity");
                connection.setRequestProperty("Cache-Control", "no-cache, no-store");
                // 清空认证头，不能将 WebView 登录信息或业务令牌传给更新站点。
                connection.setRequestProperty("Cookie", "");
                connection.setRequestProperty("Authorization", "");
                connection.setRequestProperty("Referer", "");
                int status = connection.getResponseCode();
                checkDeadline(deadline);
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    if (redirects >= MAX_REDIRECTS) throw new RequestException("更新地址超过 5 次重定向上限。");
                    String location = connection.getHeaderField("Location");
                    if (location == null || location.trim().isEmpty()) throw new RequestException("更新重定向缺少 Location。");
                    try { uri = secureUri(uri.resolve(new URI(location)).toString()); }
                    catch (URISyntaxException error) { throw new RequestException("更新重定向地址格式无效。"); }
                    close(connection);
                    continue;
                }
                if (status != HttpURLConnection.HTTP_OK) throw new RequestException("更新服务器返回 HTTP " + status + "。");
                return new OpenResponse(connection, uri.toString());
            } catch (Exception error) {
                close(connection);
                if (cancelled) throw new CancelledException();
                if (timedOut) throw new RequestException("更新请求超时，请稍后重试。");
                if (error instanceof IOException && !(error instanceof RequestException)) {
                    // 系统网络异常可能带完整 URL，只返回不含查询参数的描述。
                    throw new RequestException("更新 HTTPS 连接失败，请检查网络后重试。");
                }
                throw error;
            }
        }
    }

    private long transfer(HttpURLConnection connection, OutputStream output, long maxBytes, long deadline,
                          MessageDigest digest, Progress progress) throws Exception {
        long copied = 0;
        long lastProgress = 0;
        try (InputStream input = connection.getInputStream()) {
            byte[] buffer = new byte[32 * 1024];
            while (true) {
                checkDeadline(deadline);
                connection.setReadTimeout(timeout(deadline, 30_000));
                int count = input.read(buffer);
                checkDeadline(deadline);
                if (count < 0) break;
                if (count == 0) continue;
                if (copied > maxBytes - count) throw new RequestException("更新文件超过允许大小，下载已终止。");
                output.write(buffer, 0, count);
                if (digest != null) digest.update(buffer, 0, count);
                copied += count;
                long now = clock.nowMillis();
                if (progress != null && now - lastProgress >= 200) {
                    progress.update(copied, maxBytes);
                    lastProgress = now;
                }
            }
        } catch (IOException error) {
            if (cancelled) throw new CancelledException();
            if (timedOut) throw new RequestException("更新请求超时，请稍后重试。");
            if (!(error instanceof RequestException)) throw new RequestException("更新文件读取失败，请检查网络或可用空间。");
            throw error;
        }
        if (progress != null) progress.update(copied, maxBytes);
        return copied;
    }

    private int timeout(long deadline, int maximum) throws IOException {
        checkDeadline(deadline);
        return (int) Math.max(1, Math.min(maximum, deadline - clock.nowMillis()));
    }

    private void checkDeadline(long deadline) throws IOException {
        if (cancelled || Thread.currentThread().isInterrupted()) throw new CancelledException();
        if (timedOut || clock.nowMillis() >= deadline) throw new RequestException("更新请求超时，请稍后重试。");
    }

    private Deadline armDeadline(long timeoutMillis) {
        // 定时断开覆盖连接与响应读取的合计时限，不能只在阻塞读取结束后检查时间。
        ScheduledFuture<?> timer = DEADLINES.schedule(() -> {
            timedOut = true;
            HttpURLConnection connection = activeConnection;
            if (connection != null) connection.disconnect();
        }, timeoutMillis, TimeUnit.MILLISECONDS);
        return new Deadline(timer);
    }

    private void requireApprovedHost(URI uri) throws IOException {
        if (!allowedHosts.contains(uri.getHost().toLowerCase(Locale.ROOT))) {
            throw new RequestException("更新下载主机未获配置允许。");
        }
    }

    static URI secureUri(String source) throws Exception {
        URI uri;
        try { uri = new URI(source); }
        catch (URISyntaxException | NullPointerException error) {
            // URI 解析异常可能包含带签名的查询串，错误消息只保留类型说明。
            throw new RequestException("更新地址格式无效。");
        }
        String rawPath = uri.getRawPath() == null ? "" : uri.getRawPath().toLowerCase(Locale.ROOT);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
                || (uri.getPort() != -1 && uri.getPort() != 443) || uri.getFragment() != null
                || rawPath.contains("%2f") || rawPath.contains("%5c") || rawPath.contains("\\")) {
            throw new RequestException("更新地址必须是无凭据的 HTTPS 地址。");
        }
        for (String segment : uri.getPath().split("/", -1)) {
            if (segment.equals(".") || segment.equals("..")) throw new RequestException("更新地址不能包含相对路径段。");
        }
        return uri;
    }

    private void close(HttpURLConnection connection) {
        connection.disconnect();
        if (activeConnection == connection) activeConnection = null;
    }

    static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) value.append(String.format(Locale.ROOT, "%02x", item & 0xff));
        return value.toString();
    }

    static final class CancelledException extends IOException {
        CancelledException() { super("更新任务已取消。"); }
    }

    private static final class RequestException extends IOException {
        RequestException(String message) { super(message); }
    }

    private static final class Deadline implements AutoCloseable {
        private final ScheduledFuture<?> timer;
        Deadline(ScheduledFuture<?> timer) { this.timer = timer; }
        @Override public void close() { timer.cancel(false); }
    }

    static final class ManifestResponse {
        final String body;
        final String finalUrl;
        ManifestResponse(String body, String finalUrl) { this.body = body; this.finalUrl = finalUrl; }
    }

    static final class DownloadResponse {
        final long sizeBytes;
        final String sha256;
        DownloadResponse(long sizeBytes, String sha256) { this.sizeBytes = sizeBytes; this.sha256 = sha256; }
    }

    private static final class OpenResponse {
        final HttpURLConnection connection;
        final String finalUrl;
        OpenResponse(HttpURLConnection connection, String finalUrl) { this.connection = connection; this.finalUrl = finalUrl; }
    }
}
