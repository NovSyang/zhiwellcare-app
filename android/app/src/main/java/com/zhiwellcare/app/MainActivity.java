package com.zhiwellcare.app;

import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 本地插件必须在 Bridge 初始化前注册，TypeScript 才能调用原生更新 API。
        registerPlugin(AndroidApkUpdaterPlugin.class);
        super.onCreate(savedInstanceState);

        // 禁止 WebView 在滚动边界继续拉伸，页面滚动边界由前端内容容器统一管理。
        getBridge().getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
    }
}
