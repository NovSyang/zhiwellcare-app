package com.zhiwellcare.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 本地插件必须在 Bridge 初始化前注册，TypeScript 才能调用原生更新 API。
        registerPlugin(AndroidApkUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
