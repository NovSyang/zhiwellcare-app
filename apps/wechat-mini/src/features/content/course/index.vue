<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLoad } from '@tarojs/taro'
import { courses } from '@/shared/courses'
import { courseDayKey } from '@/shared/core'
import { courseCheckins } from '../../../app/MiniServices'

defineOptions({ name: 'CourseDetailPage' })

const id = ref('')
const dates = ref<string[]>([])
const today = ref(courseDayKey(new Date()))
const error = ref('')
const saving = ref(false)
const course = computed(() => courses.find((item) => item.id === id.value))
const checkedIn = computed(() => dates.value.includes(today.value))

// 保持原 APP 的图文跟练和每日打卡规则。
useLoad(async (options) => {
  id.value = options.id ?? ''
  if (!course.value) return
  try { dates.value = await courseCheckins.list(id.value) } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '读取打卡记录失败。'
  }
})

async function complete() {
  if (!course.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const now = new Date()
    dates.value = await courseCheckins.complete(id.value, now)
    today.value = courseDayKey(now)
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '保存打卡失败，请重试。'
  } finally { saving.value = false }
}
</script>

<template>
  <view class="mini-page">
    <template v-if="course">
      <text class="mini-heading">{{ course.title }}</text>
      <view class="mini-card">
        <text class="mini-card-title">{{ course.category }} · {{ course.level }} · 约 {{ course.durationMin }} 分钟</text>
        <text class="mini-description">{{ course.summary }}</text>
        <text v-if="course.disclaimer" class="mini-description">{{ course.disclaimer }}</text>
      </view>
      <view v-for="(step, index) in course.steps" :key="step.title" class="mini-card">
        <text class="mini-card-title">{{ index + 1 }}. {{ step.title }}</text>
        <text class="mini-description">{{ step.detail }}</text>
      </view>
      <view class="mini-card">
        <text class="mini-card-title">累计打卡 {{ dates.length }} 次</text>
        <text v-if="dates.length" class="mini-description">最近 {{ dates.slice(-3).reverse().join('、') }}</text>
        <text v-if="error" class="mini-error">{{ error }}</text>
        <button class="mini-primary" :disabled="checkedIn || saving" @tap="complete">{{ checkedIn ? '今日已打卡' : '完成跟练并打卡' }}</button>
      </view>
    </template>
    <text v-else class="mini-description">课程不存在，请返回课程列表。</text>
  </view>
</template>
