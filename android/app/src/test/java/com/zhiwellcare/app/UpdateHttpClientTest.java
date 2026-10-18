package com.zhiwellcare.app;

import org.junit.Test;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

/** 更新请求测试只使用伪连接，覆盖网络边界而不依赖真实 Gitee。 */
public class UpdateHttpClientTest {
    private static final String MANIFEST = "https://gitee.com/Syang03/zhiwell-care/raw/main/channels/stable/android-latest.json";
    private static final String BASE = "https://gitee.com/Syang03/zhiwell-care";

    @Test public void configuredManifestReturnsBodyAndFinalUrlWithoutAuthentication() throws Exception {
        FakeConnection initial = response(MANIFEST, 302, "");
        initial.location = "https://approved.example/manifest.json";
        FakeConnection finalResponse = response(initial.location, 200, "{\"schemaVersion\":1}");
        List<FakeConnection> opened = new ArrayList<>();
        UpdateHttpClient client = client(new AtomicLong(), opened, initial, finalResponse);
        UpdateHttpClient.ManifestResponse result = client.fetchManifest(MANIFEST);
        assertEquals("{\"schemaVersion\":1}", result.body);
        assertEquals(initial.location, result.finalUrl);
        for (FakeConnection connection : opened) {
            assertEquals("", connection.getRequestProperty("Authorization"));
            assertEquals("", connection.getRequestProperty("Cookie"));
            assertFalse(connection.getInstanceFollowRedirects());
            assertTrue(connection.disconnected);
        }
    }

    @Test public void wrongManifestEntryMakesNoNetworkRequest() throws Exception {
        List<FakeConnection> opened = new ArrayList<>();
        UpdateHttpClient client = client(new AtomicLong(), opened);
        assertThrows(IOException.class, () -> client.fetchManifest(BASE + "/other.json"));
        assertTrue(opened.isEmpty());
    }

    @Test public void downgradeCredentialsAndUnknownHostRedirectsAreRejected() throws Exception {
        for (String target : new String[]{"http://gitee.com/manifest", "https://user:secret@gitee.com/manifest", "https://unapproved.example/manifest"}) {
            FakeConnection initial = response(MANIFEST, 302, "");
            initial.location = target;
            List<FakeConnection> opened = new ArrayList<>();
            assertThrows(IOException.class, () -> client(new AtomicLong(), opened, initial).fetchManifest(MANIFEST));
            assertEquals(1, opened.size());
            assertTrue(initial.disconnected);
        }
    }

    @Test public void loopMissingLocationAndTooManyRedirectsCloseConnections() throws Exception {
        FakeConnection loop = response(MANIFEST, 302, "");
        loop.location = MANIFEST;
        assertThrows(IOException.class, () -> client(new AtomicLong(), new ArrayList<>(), loop).fetchManifest(MANIFEST));
        assertTrue(loop.disconnected);
        FakeConnection missing = response(MANIFEST, 302, "");
        assertThrows(IOException.class, () -> client(new AtomicLong(), new ArrayList<>(), missing).fetchManifest(MANIFEST));
        assertTrue(missing.disconnected);
        FakeConnection[] redirects = new FakeConnection[6];
        String next = MANIFEST;
        for (int i = 0; i < redirects.length; i++) {
            redirects[i] = response(next, 302, "");
            next = "https://gitee.com/redirect/" + i;
            redirects[i].location = next;
        }
        List<FakeConnection> opened = new ArrayList<>();
        assertThrows(IOException.class, () -> client(new AtomicLong(), opened, redirects).fetchManifest(MANIFEST));
        assertEquals(6, opened.size());
        for (FakeConnection connection : opened) assertTrue(connection.disconnected);
    }

    @Test public void htmlAndHttpErrorsAreUnavailableRatherThanLatest() throws Exception {
        FakeConnection html = response(MANIFEST, 200, "<!doctype html><title>login</title>");
        html.contentType = "text/html";
        assertThrows(IOException.class, () -> client(new AtomicLong(), new ArrayList<>(), html).fetchManifest(MANIFEST));
        assertTrue(html.disconnected);
        for (int status : new int[]{403, 404, 429, 500}) {
            FakeConnection failure = response(MANIFEST, status, "{}");
            IOException error = assertThrows(IOException.class, () -> client(new AtomicLong(), new ArrayList<>(), failure).fetchManifest(MANIFEST));
            assertTrue(error.getMessage().contains(String.valueOf(status)));
            assertTrue(failure.disconnected);
        }
    }

    @Test public void manifestLimitsApplyEvenWithoutContentLength() throws Exception {
        FakeConnection large = response(MANIFEST, 200, "{}");
        large.body = new byte[(int) UpdateHttpClient.MAX_MANIFEST_BYTES + 1];
        large.length = -1;
        assertThrows(IOException.class, () -> client(new AtomicLong(), new ArrayList<>(), large).fetchManifest(MANIFEST));
        assertTrue(large.disconnected);
        assertTrue(large.inputClosed);
    }

    @Test public void totalDeadlineIncludesResponseAndReadTime() throws Exception {
        AtomicLong time = new AtomicLong();
        FakeConnection slow = response(MANIFEST, 200, "{}");
        slow.onRead = () -> time.addAndGet(30_001);
        assertThrows(IOException.class, () -> client(time, new ArrayList<>(), slow).fetchManifest(MANIFEST));
        assertTrue(slow.disconnected);
        assertTrue(slow.inputClosed);
    }

    @Test public void hardDeadlineDisconnectsBeforeBlockedResponseReturns() throws Exception {
        FakeConnection blocked = response(MANIFEST, 200, "{}");
        blocked.blockUntilDisconnected = true;
        UpdateHttpClient client = new UpdateHttpClient(MANIFEST, BASE, "gitee.com", url -> blocked,
                () -> TimeUnit.NANOSECONDS.toMillis(System.nanoTime()), 50, 50);
        long began = System.nanoTime();
        IOException error = assertThrows(IOException.class, () -> client.fetchManifest(MANIFEST));
        assertTrue(error.getMessage().contains("超时"));
        assertTrue(blocked.disconnected);
        assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - began) < 2_000);
    }

    @Test public void apkMustBelongToRepositoryAndCannotOverrunExpectedBytes() throws Exception {
        UpdateHttpClient policy = client(new AtomicLong(), new ArrayList<>());
        for (String target : new String[]{"https://gitee.com/other/repo/app.apk", BASE + "/%2e%2e/other/app.apk", BASE + "%2fother/app.apk"}) {
            assertThrows(IOException.class, () -> policy.validateDownloadUrl(target));
        }
        String apk = BASE + "/releases/download/v0.1.1/app.apk";
        FakeConnection large = response(apk, 200, "12345");
        large.length = -1;
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        assertThrows(IOException.class, () -> client(new AtomicLong(), new ArrayList<>(), large).download(apk, output, 4, null));
        assertEquals(0, output.size());
        assertTrue(large.disconnected);
        assertTrue(large.inputClosed);
    }

    @Test public void validApkReportsActualHashAndTruncatedApkFails() throws Exception {
        String apk = BASE + "/releases/download/v0.1.1/app.apk";
        FakeConnection valid = response(apk, 200, "1234");
        UpdateHttpClient.DownloadResponse result = client(new AtomicLong(), new ArrayList<>(), valid).download(apk, new ByteArrayOutputStream(), 4, null);
        assertEquals(4, result.sizeBytes);
        assertEquals("03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4", result.sha256);
        FakeConnection shortResponse = response(apk, 200, "123");
        shortResponse.length = -1;
        assertThrows(IOException.class, () -> client(new AtomicLong(), new ArrayList<>(), shortResponse).download(apk, new ByteArrayOutputStream(), 4, null));
        assertTrue(shortResponse.disconnected);
    }

    @Test public void cancellationStopsBeforeOpeningConnection() throws Exception {
        List<FakeConnection> opened = new ArrayList<>();
        UpdateHttpClient client = client(new AtomicLong(), opened);
        client.cancel();
        assertThrows(UpdateHttpClient.CancelledException.class, () -> client.fetchManifest(MANIFEST));
        assertTrue(opened.isEmpty());
    }

    @Test public void cancellationDuringReadClosesInputAndConnection() throws Exception {
        FakeConnection response = response(MANIFEST, 200, "{}");
        UpdateHttpClient client = client(new AtomicLong(), new ArrayList<>(), response);
        response.onRead = client::cancel;
        assertThrows(UpdateHttpClient.CancelledException.class, () -> client.fetchManifest(MANIFEST));
        assertTrue(response.disconnected);
        assertTrue(response.inputClosed);
    }

    private static UpdateHttpClient client(AtomicLong time, List<FakeConnection> opened, FakeConnection... responses) throws Exception {
        return new UpdateHttpClient(MANIFEST, BASE, "gitee.com,approved.example", url -> {
            if (opened.size() >= responses.length) throw new AssertionError("意外的额外网络请求。");
            FakeConnection response = responses[opened.size()];
            assertEquals(response.getURL().toString(), url.toString());
            opened.add(response);
            return response;
        }, time::get);
    }

    private static FakeConnection response(String url, int status, String body) throws Exception {
        return new FakeConnection(new URL(url), status, body.getBytes(StandardCharsets.UTF_8));
    }

    /** 手动记录断开连接和流关闭，验证失败路径也能回收网络资源。 */
    private static final class FakeConnection extends HttpURLConnection {
        final int status;
        byte[] body;
        String location;
        String contentType = "application/json";
        long length;
        volatile boolean disconnected;
        boolean inputClosed;
        boolean blockUntilDisconnected;
        final CountDownLatch disconnectedSignal = new CountDownLatch(1);
        Runnable onRead;
        FakeConnection(URL url, int status, byte[] body) { super(url); this.status = status; this.body = body; length = body.length; }
        @Override public int getResponseCode() throws IOException {
            if (blockUntilDisconnected) {
                try {
                    if (!disconnectedSignal.await(3, TimeUnit.SECONDS)) throw new IOException("测试连接未被按时终止。");
                } catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IOException("测试连接被中断。"); }
            }
            return status;
        }
        @Override public long getContentLengthLong() { return length; }
        @Override public String getContentType() { return contentType; }
        @Override public String getHeaderField(String name) { return name.equals("Location") ? location : null; }
        @Override public InputStream getInputStream() {
            return new ByteArrayInputStream(body) {
                @Override public synchronized int read(byte[] target, int offset, int count) {
                    if (onRead != null) onRead.run();
                    return super.read(target, offset, count);
                }
                @Override public void close() throws IOException { inputClosed = true; super.close(); }
            };
        }
        @Override public void disconnect() { disconnected = true; disconnectedSignal.countDown(); }
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() { }
    }
}
