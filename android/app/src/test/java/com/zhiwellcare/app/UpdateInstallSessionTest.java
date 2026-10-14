package com.zhiwellcare.app;

import org.junit.Test;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import static org.junit.Assert.*;

/** 安装会话必须在两条流关闭之后提交，提交前失败必须 abandon。 */
public class UpdateInstallSessionTest {
    @Test public void fsyncThenCloseBothStreamsThenCommit() throws Exception {
        FakeSession session = new FakeSession();
        UpdateInstallSession.writeAndCommit(input(session), 3, session);
        assertEquals(Arrays.asList("open", "fsync", "output-close", "input-close", "commit", "session-close"), session.events);
        assertArrayEquals(new byte[]{1, 2, 3}, session.output.toByteArray());
        assertFalse(session.abandoned);
    }

    @Test public void writeFailureClosesResourcesAndAbandonsWithoutCommit() throws Exception {
        FakeSession session = new FakeSession();
        session.failFsync = true;
        assertThrows(IOException.class, () -> UpdateInstallSession.writeAndCommit(input(session), 3, session));
        assertFalse(session.events.contains("commit"));
        assertTrue(session.events.contains("output-close"));
        assertTrue(session.events.contains("input-close"));
        assertTrue(session.events.contains("session-close"));
        assertTrue(session.abandoned);
    }

    @Test public void commitFailureAbandonsAfterStreamsWereClosed() throws Exception {
        FakeSession session = new FakeSession();
        session.failCommit = true;
        assertThrows(IOException.class, () -> UpdateInstallSession.writeAndCommit(input(session), 3, session));
        assertTrue(session.events.indexOf("input-close") < session.events.indexOf("commit"));
        assertTrue(session.abandoned);
    }

    @Test public void openWriteFailureStillClosesInputAndAbandons() throws Exception {
        FakeSession session = new FakeSession();
        session.failOpen = true;
        assertThrows(IOException.class, () -> UpdateInstallSession.writeAndCommit(input(session), 3, session));
        assertTrue(session.events.contains("input-close"));
        assertTrue(session.abandoned);
    }

    private static ByteArrayInputStream input(FakeSession session) {
        return new ByteArrayInputStream(new byte[]{1, 2, 3}) {
            @Override public void close() throws IOException { session.events.add("input-close"); super.close(); }
        };
    }

    private static final class FakeSession implements UpdateInstallSession.Session {
        final List<String> events = new ArrayList<>();
        final ByteArrayOutputStream output = new ByteArrayOutputStream() {
            @Override public void close() throws IOException { events.add("output-close"); super.close(); }
        };
        boolean failFsync;
        boolean failCommit;
        boolean failOpen;
        boolean abandoned;
        @Override public OutputStream openWrite(long size) throws Exception { events.add("open"); if (failOpen) throw new IOException("open failed"); return output; }
        @Override public void fsync(OutputStream output) throws Exception { events.add("fsync"); if (failFsync) throw new IOException("fsync failed"); }
        @Override public void commit() throws Exception {
            events.add("commit");
            assertTrue(events.contains("input-close"));
            assertTrue(events.contains("output-close"));
            if (failCommit) throw new IOException("commit failed");
        }
        @Override public void abandon() { events.add("abandon"); abandoned = true; }
        @Override public void close() { events.add("session-close"); }
    }
}
