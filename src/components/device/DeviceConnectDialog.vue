<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { catalogService, connectionManager, syncActiveDeviceToLibrary } from '../../app/AppServices'
import { tagLabel, type MatchTag } from '../../core/catalog/CapabilityTags'
import type { DeviceModelInfo } from '../../core/catalog/DeviceCatalogTypes'
import { resolveDeviceModel } from '../../core/catalog/tagMatching'
import type { SensorDevice } from '../../core/sensor/SensorDevice'

const emit = defineEmits<{ close: []; connected: [] }>()

interface ScanRow {
  device: SensorDevice
  model: DeviceModelInfo | null
  tags: MatchTag[]
}

const devices = ref<SensorDevice[]>([])
const models = ref<DeviceModelInfo[]>([])
const scanning = ref(false)
const connectingId = ref('')
const errorMessage = ref('')
const emptyHint = ref('')
const hasBinding = ref(false)

const rows = computed<ScanRow[]>(() =>
  devices.value.map((device) => {
    const model = resolveDeviceModel(models.value, device)
    return {
      device,
      model,
      tags: model ? [...model.capabilityTags, ...model.supportedHandleTags] : [],
    }
  }),
)

/** 弹窗打开时自动搜索一次；目录解析失败不阻塞连接流程本身。 */
onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  hasBinding.value = connectionManager.getSnapshot().binding !== null
  try {
    models.value = await catalogService.listDeviceModels()
  } catch {
    models.value = []
  }
  await scan()
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

async function scan(): Promise<void> {
  scanning.value = true
  errorMessage.value = ''
  emptyHint.value = ''
  try {
    const found = await connectionManager.discoverDevicesForSelection()
    devices.value = found
    if (found.length === 0) {
      emptyHint.value = '未发现可连接的训练设备。请确认设备已开机、靠近本机并开启蓝牙后，重新搜索。'
    }
  } catch (error) {
    setError(error)
  } finally {
    scanning.value = false
  }
}

/** 点选扫描项即连接：首台设备直接连接，已有绑定则安全切换。 */
async function pick(device: SensorDevice): Promise<void> {
  if (connectingId.value !== '') return
  if (!resolveDeviceModel(models.value, device)) {
    setError('该设备未匹配到智为康乐型号目录，暂不可连接。请确认设备为智为康乐训练设备后重新搜索。')
    return
  }
  connectingId.value = device.id
  errorMessage.value = ''
  try {
    const boundId = connectionManager.getSnapshot().binding?.deviceId ?? null
    if (boundId && boundId !== device.id) await connectionManager.switchDevice(device)
    else await connectionManager.connect(device)
    await syncActiveDeviceToLibrary()
    emit('connected')
  } catch (error) {
    setError(error)
  } finally {
    connectingId.value = ''
  }
}

function setError(error: unknown): void {
  errorMessage.value = error instanceof Error ? error.message : String(error)
}

function deviceCaption(device: SensorDevice): string {
  const tail = device.address || device.id
  return tail.length > 20 ? `${tail.slice(0, 8)}…${tail.slice(-8)}` : tail
}
</script>

<template>
  <Teleport to="body">
    <div class="device-dialog-backdrop" @click.self="emit('close')">
      <section class="device-dialog connect-dialog" role="dialog" aria-modal="true" aria-label="连接新设备">
        <header>
          <div>
            <p class="eyebrow">Device</p>
            <h2>连接新设备</h2>
          </div>
          <button type="button" class="button" @click="emit('close')">关闭</button>
        </header>

        <p class="muted small dialog-intro">
          在附近搜索智为康乐训练设备。请保持设备开机、靠近本机并开启蓝牙。
          <template v-if="hasBinding">已有一台设备在运行，选择新设备后将自动切换。</template>
        </p>

        <div v-if="scanning" class="scan-status" aria-live="polite">
          <span class="loading-spinner" aria-hidden="true"></span>
          <span>正在搜索附近的训练设备…</span>
        </div>

        <template v-else>
          <p v-if="errorMessage" class="error" aria-live="polite">{{ errorMessage }}</p>
          <p v-else-if="emptyHint" class="scan-hint" aria-live="polite">{{ emptyHint }}</p>

          <ul v-if="rows.length" class="scan-list">
            <li v-for="row in rows" :key="row.device.id">
              <button
                type="button"
                class="scan-item"
                :class="{ 'is-connecting': connectingId === row.device.id }"
                :disabled="connectingId !== '' || !row.model"
                :title="row.model ? '' : '该设备未匹配到智为康乐型号目录，暂不可连接'"
                @click="pick(row.device)"
              >
                <span class="scan-icon" :class="{ 'is-unknown': !row.model }" aria-hidden="true">{{ row.model?.icon ?? '📡' }}</span>
                <span class="scan-main">
                  <span class="scan-name-row">
                    <strong>{{ row.device.name || '未命名设备' }}</strong>
                    <span v-if="!row.model" class="tag-chip is-warn">未识别设备</span>
                  </span>
                  <small class="muted scan-caption">{{ row.model ? row.model.name : '未能匹配到型号目录' }} · {{ deviceCaption(row.device) }}</small>
                  <span v-if="row.tags.length" class="tag-chip-row">
                    <span v-for="tag in row.tags" :key="tag" class="tag-chip">{{ tagLabel(tag) }}</span>
                  </span>
                </span>
                <span class="scan-action">
                  <template v-if="connectingId === row.device.id"><span class="loading-spinner" aria-hidden="true"></span><small>连接中…</small></template>
                  <span v-else-if="row.model" class="scan-arrow" aria-hidden="true">→</span>
                  <span v-else class="scan-lock" aria-hidden="true">✕</span>
                </span>
              </button>
            </li>
          </ul>

          <p v-if="rows.some((row) => !row.model)" class="muted small scan-tip">
            未识别设备通常是其他蓝牙外设或未登记的型号；智为康乐训练设备应带有对应型号的广播名称，请确认后重新搜索。
          </p>
        </template>

        <div class="dialog-footer">
          <button type="button" class="button" :disabled="scanning || connectingId !== ''" @click="scan">
            {{ scanning ? '搜索中…' : '重新搜索' }}
          </button>
          <span class="muted small">支持智为康乐官方训练设备</span>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.connect-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.dialog-intro { margin: 0; }
.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px solid var(--c-line);
}
.scan-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
  border-radius: 12px;
  background: var(--c-bg-2);
  color: var(--c-ink-2);
  font-size: 13px;
}
.scan-hint { margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--c-warn-bg); color: var(--c-warn-ink); font-size: 13px; }
.scan-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.scan-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--c-line);
  border-radius: 14px;
  background: var(--c-bg);
  color: var(--c-ink);
  text-align: left;
  cursor: pointer;
  transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease;
}
.scan-item:hover:not(:disabled) { border-color: var(--c-primary-2); box-shadow: var(--shadow-sm); transform: translateY(-1px); }
.scan-item:disabled { opacity: .55; cursor: default; }
.scan-item.is-connecting { border-color: var(--c-primary); }
.scan-icon {
  width: 44px; height: 44px; flex: 0 0 auto;
  display: grid; place-items: center;
  border-radius: 12px; background: var(--grad-brand); color: #fff;
  font-size: 22px;
}
.scan-icon.is-unknown { background: var(--c-bg-3); filter: grayscale(1); }
.scan-main { flex: 1; min-width: 0; display: grid; gap: 4px; }
.scan-name-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.scan-name-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.scan-caption { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scan-action { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; color: var(--c-primary); min-width: 64px; justify-content: flex-end; }
.scan-action small { font-size: 12px; }
.scan-arrow { font-size: 16px; font-weight: 700; }
.scan-lock { color: var(--c-ink-3); font-size: 12px; }
.scan-tip { margin: 2px 0 0; line-height: 1.7; }
</style>
