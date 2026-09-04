<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useDeviceLibraryStore, type DeviceLibraryItem } from '../../stores/deviceLibrary'

const props = defineProps<{ item: DeviceLibraryItem }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const library = useDeviceLibraryStore()
const alias = ref(props.item.alias)
const saving = ref(false)
const errorMessage = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

onMounted(() => {
  inputEl.value?.focus()
  inputEl.value?.select()
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

async function save(): Promise<void> {
  const trimmed = alias.value.trim()
  if (!trimmed) {
    errorMessage.value = '别名不能为空。'
    return
  }
  if (trimmed.length > 24) {
    errorMessage.value = '别名最多 24 个字符。'
    return
  }
  saving.value = true
  errorMessage.value = ''
  try {
    await library.rename(props.item.deviceId, trimmed)
    emit('saved')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="device-dialog-backdrop" @click.self="emit('close')">
      <section class="device-dialog rename-dialog" role="dialog" aria-modal="true" aria-label="重命名设备">
        <header>
          <div>
            <p class="eyebrow">Device</p>
            <h2>重命名设备</h2>
          </div>
          <button type="button" class="button" :disabled="saving" @click="emit('close')">关闭</button>
        </header>

        <p class="muted small">给这台设备起一个好记的名字，例如「客厅训练仪」。别名只在本机设备库中使用。</p>

        <form @submit.prevent="save">
          <label class="rename-label" for="device-alias-input">别名</label>
          <input
            id="device-alias-input"
            ref="inputEl"
            v-model="alias"
            type="text"
            maxlength="24"
            autocomplete="off"
            placeholder="输入设备别名"
            :disabled="saving"
          />
          <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
          <div class="rename-actions">
            <button type="button" class="button" :disabled="saving" @click="emit('close')">取消</button>
            <button type="submit" class="button primary" :disabled="saving || !alias.trim()">
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.rename-dialog { display: flex; flex-direction: column; gap: 14px; }
.rename-label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; color: var(--c-ink-2); }
.rename-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
</style>
