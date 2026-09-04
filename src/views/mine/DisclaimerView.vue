<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

function backToMine(): void { void router.push('/mine') }
</script>

<template>
  <main class="content-page">
    <header class="subpage-head">
      <button class="button ghost small subpage-back" type="button" @click="backToMine">← 返回</button>
      <div class="subpage-head-text">
        <p class="eyebrow">Disclaimer &amp; Privacy</p>
        <h1>免责声明与隐私</h1>
      </div>
    </header>

    <div class="subpage-body">
      <p class="compliance-note"><strong>请知悉：</strong>智为康乐（ZhiWellCare）为消费级健身产品，本页为产品与服务的统一使用说明，请在使用前完整阅读。</p>

      <section class="card">
        <h2>产品定位说明</h2>
        <p>智为康乐为纯消费级居家主动训练产品，面向个人日常健身锻炼场景，不针对任何疾病或健康状态。</p>
        <p class="muted small">产品不包含医用器械功能，不提供疾病诊断类能力，无被动电机驱动；所有训练动作均由使用者主动发力完成。</p>
      </section>

      <section class="card">
        <h2>主动发力与量力而行</h2>
        <p>全部设备仅支持使用者主动发力，对抗阻尼或阻力完成训练，不依赖任何外部动力。</p>
        <p class="muted small">训练过程中请量力而行、循序渐进；如训练中感到明显不适（如头晕、胸闷或关节异常疼痛等），请立即停止训练并适当休息。</p>
      </section>

      <section class="card">
        <h2>硬件声明</h2>
        <p>消费版硬件与固件不具备医用功能，仅用于日常健身场景的主动训练。</p>
        <p class="muted small">固件升级仅支持消费版设备；服务端会强制拦截非消费版固件的升级请求。请勿将本产品作为医用器械使用，或用于任何疾病相关的目的。</p>
      </section>

      <section class="card">
        <h2>上门服务声明</h2>
        <p>上门服务为居家健身指导服务，属于健身服务范畴，而非医学服务。</p>
        <p class="muted small">服务人员仅提供健身动作指导与训练安排建议，不提供任何疾病诊断或健康建议。如有疾病史或健康疑虑，请咨询执业医师，并前往正规医院进行检查。</p>
      </section>

      <section class="card">
        <h2>数据与隐私说明</h2>
        <p>训练数据仅用于个人统计与训练建议，不会向任何第三方出售或共享。</p>
        <p class="muted small">当前为演示环境：训练记录等数据仅保存在本机（IndexedDB / localStorage），不会上传网络。账号体系与云端同步功能待后端上线后开放，届时将同步更新相关说明。</p>
      </section>

      <button class="button ghost wide subpage-bottom-button" type="button" @click="backToMine">返回我的</button>

      <footer class="page-footnote"><p class="muted small">智为康乐 ZhiWellCare · 免责声明与隐私 · v0.1.0</p></footer>
    </div>
  </main>
</template>

<style scoped>
.subpage-head { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
.subpage-back { flex: 0 0 auto; }
.subpage-head-text { min-width: 0; }
.subpage-head-text h1 { margin-bottom: 0; }
.subpage-body { display: flex; flex-direction: column; gap: 16px; }
.subpage-body .card h2 { font-size: 17px; margin-bottom: 10px; }
.subpage-body .card p:last-child { margin-bottom: 0; }
.subpage-bottom-button { min-height: 48px; }
.page-footnote { text-align: center; padding: 2px 0 6px; }
.page-footnote p { margin: 0; }
</style>
