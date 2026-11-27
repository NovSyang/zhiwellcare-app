<script setup lang="ts">
import { computed, ref } from 'vue'
import Taro, { useDidShow } from '@tarojs/taro'
import { summarizeCourseCheckins } from '@/shared/core'
import { courses, courseCategories } from '@/shared/courses'
import { courseCheckins } from '../../app/MiniServices'
import { navigateMini, useMiniTabPage } from '../../app/MiniPageSafety'
import MiniPageHeader from '../../components/app/MiniPageHeader.vue'

defineOptions({ name: 'CoursesPage' })
const viewport = useMiniTabPage('pages/courses/index')

const category = ref('全部')
const checkins = ref<Record<string, string[]>>({})
const now = ref(new Date())
const checkinError = ref('')
const stats = computed(() => summarizeCourseCheckins(checkins.value, now.value))
const visibleCourses = computed(() => category.value === '全部' ? courses : courses.filter((item) => item.category === category.value))

// 从详情打卡返回本页时重新统计，离线也能显示当天进度。
useDidShow(async () => {
  now.value = new Date()
  checkinError.value = ''
  try {
    checkins.value = await courseCheckins.listAll()
  } catch (failure) {
    checkinError.value = failure instanceof Error ? failure.message : '读取打卡记录失败。'
  }
})

// 课程仅传递稳定 ID，详情页加载当前目录中的完整动作说明。
function openCourse(id: string) {
  void navigateMini(() => Taro.navigateTo({ url: `/features/content/course/index?id=${encodeURIComponent(id)}` }))
    .catch(() => { checkinError.value = '暂时无法打开课程详情，请重试。' })
}
</script>

<template>
  <view class="mini-tab-page" :style="viewport">
    <MiniPageHeader title="课程" />
    <scroll-view scroll-y class="mini-tab-scroll">
      <view class="mini-page mini-tab-content">
        <view class="mini-card">
          <text class="mini-card-title">打卡进度</text>
          <text v-if="checkinError" class="mini-error">{{ checkinError }}</text>
          <view v-else class="mini-metrics">
            <view class="mini-metric">
              <text class="mini-metric-value">{{ stats.todayCount }}</text>
              <text class="mini-metric-label">今日次数</text>
            </view>
            <view class="mini-metric">
              <text class="mini-metric-value">{{ stats.streakDays }}</text>
              <text class="mini-metric-label">连续天数</text>
            </view>
            <view class="mini-metric">
              <text class="mini-metric-value">{{ stats.totalCount }}</text>
              <text class="mini-metric-label">累计次数</text>
            </view>
          </view>
        </view>
        <view class="mini-filters">
          <button v-for="item in courseCategories" :key="item" size="mini" :class="{ 'mini-primary': category === item }" @tap="category = item">
            {{ item }}
          </button>
        </view>
        <view v-for="course in visibleCourses" :key="course.id" class="mini-card" @tap="openCourse(course.id)">
          <text class="mini-card-title">{{ course.cover }} {{ course.title }}</text>
          <text class="mini-description">{{ course.category }} · {{ course.level }} · 约 {{ course.durationMin }} 分钟</text>
          <text class="mini-description">{{ course.summary }}</text>
          <text v-if="checkins[course.id]?.includes(stats.day)" class="mini-description mini-today">今日已打卡</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>
