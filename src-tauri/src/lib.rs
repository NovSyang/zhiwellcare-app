use btleplug::api::{
    Central, CharPropFlags, Manager as _, Peripheral as _, ScanFilter, WriteType,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures::StreamExt;
use serde::Serialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{async_runtime::JoinHandle, AppHandle, Emitter, State};
use tokio::sync::Mutex;
use uuid::Uuid;

const SERVICE_UUID: Uuid = Uuid::from_u128(0x0000ffe5_0000_1000_8000_00805f9a34fb);
const NOTIFY_UUID: Uuid = Uuid::from_u128(0x0000ffe4_0000_1000_8000_00805f9a34fb);
const WRITE_UUID: Uuid = Uuid::from_u128(0x0000ffe9_0000_1000_8000_00805f9a34fb);

#[derive(Default)]
struct BleRuntime {
    adapter: Option<Adapter>,
    peripheral: Option<Peripheral>,
    // 使用 Tauri 运行时句柄，类型与 tauri::async_runtime::spawn 的返回值保持一致。
    notify_task: Option<JoinHandle<()>>,
}

struct BleState(Mutex<BleRuntime>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SensorDevice {
    id: String,
    name: String,
    address: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BleDataEvent {
    data: Vec<u8>,
    timestamp_ms: u64,
}

#[derive(Clone, Serialize)]
struct BleStateEvent {
    state: String,
    message: Option<String>,
}

fn emit_state(app: &AppHandle, state: &str, message: Option<String>) {
    let _ = app.emit(
        "bsbt91-state",
        BleStateEvent {
            state: state.to_string(),
            message,
        },
    );
}

async fn create_adapter() -> Result<Adapter, String> {
    let manager = Manager::new().await.map_err(|e| e.to_string())?;
    let adapters = manager.adapters().await.map_err(|e| e.to_string())?;
    adapters
        .into_iter()
        .next()
        .ok_or_else(|| "未找到可用的 Bluetooth 适配器".to_string())
}

#[tauri::command]
async fn ble_scan(app: AppHandle, state: State<'_, BleState>) -> Result<Vec<SensorDevice>, String> {
    emit_state(&app, "scanning", None);

    let adapter = create_adapter().await?;
    adapter
        .start_scan(ScanFilter::default())
        .await
        .map_err(|e| e.to_string())?;
    tokio::time::sleep(Duration::from_secs(3)).await;

    let peripherals = adapter.peripherals().await.map_err(|e| e.to_string())?;
    let mut devices = Vec::new();

    for peripheral in peripherals {
        let Some(properties) = peripheral.properties().await.map_err(|e| e.to_string())? else {
            continue;
        };
        let name = properties.local_name.unwrap_or_else(|| "Unknown BLE".to_string());
        if !name.to_ascii_uppercase().contains("BS") {
            continue;
        }

        devices.push(SensorDevice {
            id: peripheral.id().to_string(),
            name,
            address: properties.address.to_string(),
        });
    }

    {
        let mut runtime = state.0.lock().await;
        runtime.adapter = Some(adapter);
    }

    emit_state(&app, "idle", None);
    Ok(devices)
}

#[tauri::command]
async fn ble_connect(
    app: AppHandle,
    state: State<'_, BleState>,
    device_id: String,
) -> Result<(), String> {
    emit_state(&app, "connecting", None);

    let adapter = {
        let runtime = state.0.lock().await;
        runtime.adapter.clone()
    };
    let adapter = match adapter {
        Some(adapter) => adapter,
        None => create_adapter().await?,
    };

    // 扫描命令刚执行过时，适配器通常已缓存目标设备，先复用可减少一次固定等待。
    let mut peripherals = adapter.peripherals().await.map_err(|e| e.to_string())?;
    if !peripherals.iter().any(|p| p.id().to_string() == device_id) {
        adapter
            .start_scan(ScanFilter::default())
            .await
            .map_err(|e| e.to_string())?;
        tokio::time::sleep(Duration::from_secs(2)).await;
        peripherals = adapter.peripherals().await.map_err(|e| e.to_string())?;
    }
    let peripheral = peripherals
        .into_iter()
        .find(|p| p.id().to_string() == device_id)
        .ok_or_else(|| "扫描结果中未找到目标 BS-BT91，请重新扫描".to_string())?;

    if !peripheral.is_connected().await.map_err(|e| e.to_string())? {
        peripheral.connect().await.map_err(|e| e.to_string())?;
    }

    emit_state(&app, "discovering", None);
    peripheral
        .discover_services()
        .await
        .map_err(|e| e.to_string())?;

    let characteristics = peripheral.characteristics();
    let has_service = characteristics.iter().any(|c| c.service_uuid == SERVICE_UUID);
    if !has_service {
        let _ = peripheral.disconnect().await;
        return Err("目标设备不存在 FFE5 Service，可能不是兼容的 BS-BT91".to_string());
    }

    let notify_characteristic = characteristics
        .iter()
        .find(|c| {
            c.uuid == NOTIFY_UUID
                && c.service_uuid == SERVICE_UUID
                && c.properties.contains(CharPropFlags::NOTIFY)
        })
        .cloned()
        .ok_or_else(|| "未找到 FFE4 Notify Characteristic".to_string())?;

    emit_state(&app, "subscribing", None);
    peripheral
        .subscribe(&notify_characteristic)
        .await
        .map_err(|e| e.to_string())?;

    let mut notifications = peripheral.notifications().await.map_err(|e| e.to_string())?;
    let app_for_task = app.clone();
    let peripheral_for_task = peripheral.clone();
    let task = tauri::async_runtime::spawn(async move {
        while let Some(notification) = notifications.next().await {
            if notification.uuid != NOTIFY_UUID {
                continue;
            }
            let _ = app_for_task.emit(
                "bsbt91-data",
                BleDataEvent {
                    data: notification.value,
                    timestamp_ms: now_ms(),
                },
            );
        }

        let connected = peripheral_for_task.is_connected().await.unwrap_or(false);
        if !connected {
            emit_state(
                &app_for_task,
                "disconnected",
                Some("BLE 通知流已结束".to_string()),
            );
        }
    });

    {
        let mut runtime = state.0.lock().await;
        if let Some(old_task) = runtime.notify_task.take() {
            old_task.abort();
        }
        runtime.adapter = Some(adapter);
        runtime.peripheral = Some(peripheral);
        runtime.notify_task = Some(task);
    }

    emit_state(&app, "connected", None);
    Ok(())
}

#[tauri::command]
async fn ble_disconnect(app: AppHandle, state: State<'_, BleState>) -> Result<(), String> {
    let (peripheral, notify_task) = {
        let mut runtime = state.0.lock().await;
        (runtime.peripheral.take(), runtime.notify_task.take())
    };

    if let Some(task) = notify_task {
        task.abort();
    }
    if let Some(peripheral) = peripheral {
        let _ = peripheral.disconnect().await;
    }

    emit_state(&app, "disconnected", None);
    Ok(())
}

#[tauri::command]
async fn ble_write(state: State<'_, BleState>, data: Vec<u8>) -> Result<(), String> {
    let peripheral = {
        let runtime = state.0.lock().await;
        runtime.peripheral.clone()
    }
    .ok_or_else(|| "BS-BT91 尚未连接".to_string())?;

    let characteristic = peripheral
        .characteristics()
        .iter()
        .find(|c| c.uuid == WRITE_UUID && c.service_uuid == SERVICE_UUID)
        .cloned()
        .ok_or_else(|| "未找到 FFE9 Write Characteristic".to_string())?;

    let write_type = if characteristic
        .properties
        .contains(CharPropFlags::WRITE_WITHOUT_RESPONSE)
    {
        WriteType::WithoutResponse
    } else {
        WriteType::WithResponse
    };

    peripheral
        .write(&characteristic, &data, write_type)
        .await
        .map_err(|e| e.to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Updater 只负责桌面更新，安装时由官方插件校验 Tauri 签名。
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(BleState(Mutex::new(BleRuntime::default())))
        .invoke_handler(tauri::generate_handler![
            ble_scan,
            ble_connect,
            ble_disconnect,
            ble_write
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
