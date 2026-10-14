package com.zhiwellcare.app;

import org.junit.Test;
import java.io.IOException;
import java.net.CookieHandler;
import java.net.URI;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** 模拟 Capacitor 的全局 Cookie 管理器，证明匿名更新不会破坏其它业务线程。 */
public class UpdateCookieIsolationTest {
    private static final URI URI_UNDER_TEST = URI.create("https://gitee.com/manifest.json");

    @Test public void updateScopeOmitsCookiesAndDiscardsResponseCookies() throws Exception {
        CookieHandler original = CookieHandler.getDefault();
        RecordingHandler recording = new RecordingHandler();
        CookieHandler.setDefault(recording);
        try {
            try (UpdateCookieIsolation.Scope scope = UpdateCookieIsolation.begin()) {
                assertTrue(CookieHandler.getDefault().get(URI_UNDER_TEST, Collections.emptyMap()).isEmpty());
                CookieHandler.getDefault().put(URI_UNDER_TEST, Collections.singletonMap("Set-Cookie", Collections.singletonList("token=new")));
                assertEquals(0, recording.reads);
                assertEquals(0, recording.writes);
            }
            assertEquals("token=business", CookieHandler.getDefault().get(URI_UNDER_TEST, Collections.emptyMap()).get("Cookie").get(0));
            CookieHandler.getDefault().put(URI_UNDER_TEST, Collections.emptyMap());
            assertEquals(1, recording.reads);
            assertEquals(1, recording.writes);
        } finally {
            CookieHandler.setDefault(original);
        }
    }

    @Test public void simultaneousBusinessThreadKeepsItsLoginCookies() throws Exception {
        CookieHandler original = CookieHandler.getDefault();
        RecordingHandler recording = new RecordingHandler();
        CookieHandler.setDefault(recording);
        try (UpdateCookieIsolation.Scope scope = UpdateCookieIsolation.begin()) {
            AtomicReference<Map<String, List<String>>> businessCookies = new AtomicReference<>();
            Thread business = new Thread(() -> {
                try {
                    businessCookies.set(CookieHandler.getDefault().get(URI_UNDER_TEST, Collections.emptyMap()));
                    CookieHandler.getDefault().put(URI_UNDER_TEST, Collections.emptyMap());
                } catch (IOException error) { throw new AssertionError(error); }
            });
            business.start();
            business.join();
            assertEquals("token=business", businessCookies.get().get("Cookie").get(0));
            assertEquals(1, recording.writes);
            assertTrue(CookieHandler.getDefault().get(URI_UNDER_TEST, Collections.emptyMap()).isEmpty());
        } finally {
            CookieHandler.setDefault(original);
        }
    }

    @Test public void nestedScopeRemainsAnonymousUntilOuterScopeCloses() throws Exception {
        CookieHandler original = CookieHandler.getDefault();
        CookieHandler.setDefault(new RecordingHandler());
        try {
            try (UpdateCookieIsolation.Scope outer = UpdateCookieIsolation.begin()) {
                try (UpdateCookieIsolation.Scope inner = UpdateCookieIsolation.begin()) {
                    assertTrue(CookieHandler.getDefault().get(URI_UNDER_TEST, Collections.emptyMap()).isEmpty());
                }
                assertTrue(CookieHandler.getDefault().get(URI_UNDER_TEST, Collections.emptyMap()).isEmpty());
            }
            assertFalse(CookieHandler.getDefault().get(URI_UNDER_TEST, Collections.emptyMap()).isEmpty());
        } finally {
            CookieHandler.setDefault(original);
        }
    }

    private static final class RecordingHandler extends CookieHandler {
        int reads;
        int writes;
        @Override public Map<String, List<String>> get(URI uri, Map<String, List<String>> headers) {
            ++reads;
            return Collections.singletonMap("Cookie", Collections.singletonList("token=business"));
        }
        @Override public void put(URI uri, Map<String, List<String>> headers) { ++writes; }
    }
}
