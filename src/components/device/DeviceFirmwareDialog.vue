<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { DeviceModelInfo } from '../../core/catalog/DeviceCatalogTypes'
import type { DeviceLibraryItem } from '../../stores/deviceLibrary'

defineProps<{ item: DeviceLibraryItem; model: DeviceModelInfo | null }>()
const emit = defineEmits<{ close: [] }>()

const checking = ref(false)
const result = ref('')

/** 演示环境不执行真实 OTA；短暂模拟一次服务端白名单校验的提示。 */
async function checkFirmware(): Promise<void> {
  if (checking.value) return
  checking.value = true
  result.value = ''
  await new Promise<void>((resolve) => setTimeout(resolve, 500))
  checking.value = false
  result.value = '演示环境：已是最新版本'
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="device-dialog-backdrop" @click.self="emit('close')">
      <section class="device-dialog firmware-dialog" role="dialog" aria-modal="true" aria-label="固件信息">
        <header>
          <div>
            <p class="eyebrow">Device</p>
            <h2>固件信息</h2>
          </div>
          <button type="button" class="button" :disabled="checking" @click="emit('close')">关闭</button>
        </header>

        <p class="muted">{{ item.alias }} · {{ item.modelName }}</p>

        <ul class="firmware-points">
          <li><strong>消费版固件：</strong>设备预装智为康乐官方消费版固件，仅面向日常健身与主动发力训练，无医疗功能、无被动驱动。</li>
          <li><strong>服务端白名单校验：</strong>固件版本与设备序列号白名单校验由智为康乐服务端执行，只有白名单内的型号可以更新。</li>
          <li><strong>演示环境：</strong>当前不执行真实 OTA 升级，以下操作仅模拟提示结果。</li>
          <li v-if="model && !model.firmwareUpdatable"><strong>出厂维护：</strong>该型号固件由出厂预装维护，暂不开放用户侧更新。</li>
        </ul>

        <button type="button" class="button primary wide" :disabled="checking" @click="checkFirmware">
          {{ checking ? '检查中…' : '检查更新' }}
        </button>
        <p v-if="result" class="success-text firmware-result" aria-live="polite">{{ result }}</p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.firmware-dialog { display: flex; flex-direction: column; gap: 14px; }
.firmware-points { margin: 0; padding-left: 20px; display: grid; gap: 8px; }
.firmware-points li { font-size: 13px; line-height: 1.8; color: var(--c-ink-2); }
.firmware-points strong { color: var(--c-ink); }
.firmware-result { margin: 0; font-size: 14px; font-weight: 600; text-align: center; }
</style>
