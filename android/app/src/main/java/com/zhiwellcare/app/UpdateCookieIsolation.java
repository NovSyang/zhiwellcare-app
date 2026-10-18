package com.zhiwellcare.app;

import java.io.IOException;
import java.net.CookieHandler;
import java.net.URI;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/** 更新线程匿名请求；其它线程仍委托 Capacitor 原有 Cookie 管理器。 */
final class UpdateCookieIsolation {
    private static final ThreadLocal<Boolean> ANONYMOUS = new ThreadLocal<>();

    static synchronized Scope begin() {
        CookieHandler current = CookieHandler.getDefault();
        if (!(current instanceof DelegatingHandler)) {
            // HttpURLConnection 会自行询问全局 CookieHandler，单独清空请求头并不足够。
            CookieHandler.setDefault(new DelegatingHandler(current));
        }
        Boolean previous = ANONYMOUS.get();
        ANONYMOUS.set(true);
        return new Scope(previous);
    }

    static final class Scope implements AutoCloseable {
        private final Boolean previous;
        private Scope(Boolean previous) { this.previous = previous; }
        @Override public void close() {
            // 支持嵌套调用，并确保复用工作线程时不会影响下一项业务。
            if (previous == null) ANONYMOUS.remove();
            else ANONYMOUS.set(previous);
        }
    }

    private static final class DelegatingHandler extends CookieHandler {
        private final CookieHandler delegate;
        DelegatingHandler(CookieHandler delegate) { this.delegate = delegate; }
        @Override public Map<String, List<String>> get(URI uri, Map<String, List<String>> headers) throws IOException {
            if (Boolean.TRUE.equals(ANONYMOUS.get()) || delegate == null) return Collections.emptyMap();
            return delegate.get(uri, headers);
        }
        @Override public void put(URI uri, Map<String, List<String>> headers) throws IOException {
            // 更新响应的 Set-Cookie 也不写回用户的业务登录会话。
            if (!Boolean.TRUE.equals(ANONYMOUS.get()) && delegate != null) delegate.put(uri, headers);
        }
    }
}
