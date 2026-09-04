<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { mockCatalog } from '../../data/catalog'
import { tagLabel } from '../../core/catalog/CapabilityTags'
import type { MatchTag } from '../../core/catalog/CapabilityTags'
import type { DeviceModelInfo } from '../../core/catalog/DeviceCatalogTypes'
import type { DeviceLibraryItem } from '../../stores/deviceLibrary'

const props = defineProps<{ item: DeviceLibraryItem }>()
const emit = defineEmits<{ close: [] }>()

/** 说明书以本地 Mock 目录型号资料为来源；后端目录就绪后由服务端资料页承接。 */
const mockModel = computed<DeviceModelInfo | null>(
  () => mockCatalog.deviceModels.find((model) => model.modelId === props.item.modelId) ?? null,
)

const description = computed(() =>
  mockModel.value?.description
  ?? '该设备为智为康乐消费级智能训练设备，仅用于日常健身锻炼。具体型号资料请以随附说明书为准。',
)

const steps = computed<string[]>(() => {
  const model = mockModel.value
  if (model?.modelId === 'desk-torque-base') {
    return [
      '将底座平稳放在桌面上，检查底部防滑垫是否贴紧桌面。',
      '安装要使用的手柄配件，确认卡扣到位、无松动。',
      '主动发力推动手柄，感受阻力是否顺畅、符合自己习惯。',
      '在「设备首页」点击“连接新设备”完成配对后即可开始训练。',
    ]
  }
  if (model?.modelId === 'wobble-wrist-band') {
    return [
      '将腕带佩戴在手腕并调整松紧，佩戴舒适且不会滑动。',
      '开启设备电源，等待指示灯亮起并稳定。',
      '保持手腕自然放松，先做几次缓慢的挥腕动作确认手感。',
      '在「设备首页」点击“连接新设备”完成配对后即可开始训练。',
    ]
  }
  return [
    '确认设备已充电并开机。',
    '让设备靠近本机（1 米以内），并开启蓝牙。',
    '在「设备首页」点击“连接新设备”完成配对后即可开始训练。',
  ]
})

function capabilityLabels(tags: readonly string[]): string[] {
  return tags.map((tag) => tagLabel(tag as MatchTag))
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
      <section class="device-dialog manual-dialog" role="dialog" aria-modal="true" aria-label="设备说明书">
        <header>
          <div>
            <p class="eyebrow">Device</p>
            <h2>说明书 · 快速上手</h2>
          </div>
          <button type="button" class="button" @click="emit('close')">关闭</button>
        </header>

        <div class="manual-head">
          <span class="manual-icon" aria-hidden="true">{{ mockModel?.icon ?? '📡' }}</span>
          <div class="manual-titles">
            <h3>{{ item.alias }}</h3>
            <p class="muted">{{ item.modelName }}</p>
          </div>
        </div>

        <div v-if="item.capabilityTags.length" class="tag-chip-row">
          <span v-for="tag in capabilityLabels(item.capabilityTags)" :key="tag" class="tag-chip">{{ tag }}</span>
        </div>

        <div class="manual-block">
          <h4>设备说明</h4>
          <p class="muted">{{ description }}</p>
        </div>

        <div class="manual-block">
          <h4>快速上手</h4>
          <ol class="manual-steps">
            <li v-for="(step, index) in steps" :key="index">{{ step }}</li>
          </ol>
        </div>

        <p class="muted small manual-note">以上“快速上手”为演示占位说明，正式版由各型号说明书资料页提供。</p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.manual-dialog { display: flex; flex-direction: column; gap: 14px; }
.manual-head { display: flex; align-items: center; gap: 12px; }
.manual-icon {
  width: 48px; height: 48px; flex: 0 0 auto;
  display: grid; place-items: center;
  border-radius: 14px; background: var(--grad-brand); color: #fff;
  font-size: 24px;
}
.manual-titles h3 { margin: 0; font-size: 17px; }
.manual-titles p { margin: 2px 0 0; font-size: 13px; }
.manual-block h4 { margin: 0 0 6px; font-size: 14px; color: var(--c-ink); }
.manual-block p { margin: 0; font-size: 13px; line-height: 1.8; }
.manual-steps { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
.manual-steps li { font-size: 13px; line-height: 1.8; color: var(--c-ink-2); }
.manual-note { margin: 0; }
</style>
