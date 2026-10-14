package com.zhiwellcare.app;

import java.io.InputStream;
import java.io.OutputStream;

/** 把安装流的关闭顺序独立出来，便于 JVM 测试检查 commit 的前置条件。 */
final class UpdateInstallSession {
    interface Session extends AutoCloseable {
        OutputStream openWrite(long size) throws Exception;
        void fsync(OutputStream output) throws Exception;
        void commit() throws Exception;
        void abandon() throws Exception;
        @Override void close() throws Exception;
    }

    static void writeAndCommit(InputStream source, long size, Session session) throws Exception {
        boolean committed = false;
        try (Session managedSession = session) {
            // fsync 只负责落盘；两个流真正关闭后才允许提交安装会话。
            try (InputStream input = source; OutputStream output = managedSession.openWrite(size)) {
                byte[] buffer = new byte[32 * 1024];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (count > 0) output.write(buffer, 0, count);
                }
                managedSession.fsync(output);
            }
            managedSession.commit();
            committed = true;
        } catch (Exception error) {
            if (!committed) {
                try { session.abandon(); }
                catch (Exception abandonError) { error.addSuppressed(abandonError); }
            }
            throw error;
        }
    }
}
