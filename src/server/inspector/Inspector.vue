<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps<{ dbUrl: string; clientUrl?: string }>()

const ATTR_SKIP = new Set(['id', 'type'])

function entityAttrs(entity: Record<string, unknown>) {
  return Object.entries(entity).filter(([key]) => !ATTR_SKIP.has(key))
}

function clientAppUrl(): string {
  if (props.clientUrl) return props.clientUrl
  const host = window.location.origin
  const db = new URL(props.dbUrl).origin
  if (host !== db) return host
  return 'http://localhost:4000'
}

// ── Panel state ───────────────────────────────────────────────────────────────
const isOpen = ref(false)
const activeTab = ref<'entities' | 'query' | 'stats'>('entities')

// ── Drag state ────────────────────────────────────────────────────────────────
const pos = reactive({ x: 0, y: 0 })
const isDragging = ref(false)
const drag = reactive({ sx: 0, sy: 0, px: 0, py: 0 })

function onHeaderMouseDown(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.tdb-close, .tdb-link')) return
  isDragging.value = true
  drag.sx = e.clientX; drag.sy = e.clientY
  drag.px = pos.x;     drag.py = pos.y
  e.preventDefault()
}
function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  pos.x = drag.px + (e.clientX - drag.sx)
  pos.y = drag.py + (e.clientY - drag.sy)
}
function onMouseUp() { isDragging.value = false }

onMounted(() => {
  pos.x = window.innerWidth - 360 - 20
  pos.y = window.innerHeight - 48 - 20
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
})
onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})

// ── Entities ──────────────────────────────────────────────────────────────────
const entities = ref<Record<string, any>[]>([])
const entityTypes = ref<string[]>([])
const selectedType = ref<string | null>(null)
const expandedIds = ref(new Set<string>())
const loadingEntities = ref(false)

const filteredEntities = computed(() =>
  selectedType.value ? entities.value.filter(e => e.type === selectedType.value) : entities.value
)

async function fetchEntities() {
  loadingEntities.value = true
  try {
    const res = await fetch(`${props.dbUrl}/entities?limit=200`)
    const json = await res.json()
    entities.value = json.data ?? []
    entityTypes.value = [...new Set(entities.value.map((e: any) => e.type as string))]
  } catch { entities.value = [] }
  finally { loadingEntities.value = false }
}

function toggleExpand(id: string) {
  const s = new Set(expandedIds.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expandedIds.value = s
}

// ── Query ─────────────────────────────────────────────────────────────────────
const queryText = ref('')
const queryResult = ref<any>(null)
const queryError = ref<string | null>(null)
const queryLoading = ref(false)

const EXAMPLES = [
  'find Note',
  'find Note where pinned = "true"',
  'find Note limit 5',
]

async function runQuery() {
  if (!queryText.value.trim()) return
  queryLoading.value = true; queryError.value = null; queryResult.value = null
  try {
    const res = await fetch(`${props.dbUrl}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryText.value }),
    })
    const json = await res.json()
    if (json.error) throw new Error(json.error)
    queryResult.value = json
  } catch (e: any) { queryError.value = e.message }
  finally { queryLoading.value = false }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
const health = ref<any>(null)
const entityCounts = ref<Record<string, number>>({})
const totalEntities = ref(0)

const ENDPOINTS = [
  { m: 'GET',    p: '/health' },
  { m: 'GET',    p: '/entities' },
  { m: 'POST',   p: '/entities' },
  { m: 'GET',    p: '/entities/:id' },
  { m: 'PUT',    p: '/entities/:id' },
  { m: 'DELETE', p: '/entities/:id' },
  { m: 'POST',   p: '/query' },
  { m: 'POST',   p: '/upload' },
  { m: 'GET',    p: '/files/:hash' },
]

async function fetchStats() {
  try {
    const [h, e] = await Promise.all([
      fetch(`${props.dbUrl}/health`).then(r => r.json()).catch(() => null),
      fetch(`${props.dbUrl}/entities?limit=500`).then(r => r.json()).catch(() => null),
    ])
    health.value = h
    if (e?.data) {
      const counts: Record<string, number> = {}
      for (const ent of e.data) counts[ent.type] = (counts[ent.type] ?? 0) + 1
      entityCounts.value = counts
      totalEntities.value = e.total ?? e.data.length
    }
  } catch { /* silent */ }
}

// ── Tab control ───────────────────────────────────────────────────────────────
function switchTab(tab: typeof activeTab.value) {
  activeTab.value = tab
  if (tab === 'entities') fetchEntities()
  else if (tab === 'stats') fetchStats()
}
function open() { isOpen.value = true; switchTab(activeTab.value) }
function close() { isOpen.value = false }
</script>

<template>
  <!-- Toggle pill -->
  <div v-if="!isOpen" class="tdb-toggle" @mousedown.prevent="onHeaderMouseDown" @click.stop="open"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px` }">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/>
    </svg>
    <span>DB</span>
  </div>

  <!-- Inspector panel -->
  <div v-else class="tdb-panel" :style="{ left: `${pos.x}px`, top: `${pos.y}px` }">

    <!-- Header -->
    <div class="tdb-header" @mousedown.prevent="onHeaderMouseDown">
      <div class="tdb-header-l">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2">
          <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/>
        </svg>
        <span class="tdb-title">Trellis DB</span>
      </div>
      <div class="tdb-header-r">
        <a class="tdb-link" :href="clientAppUrl()" target="_blank" rel="noopener noreferrer">Open App ↗</a>
        <button class="tdb-close" @click.stop="close">✕</button>
      </div>
    </div>

    <!-- URL bar -->
    <div class="tdb-urlbar">
      <span class="tdb-dot">◉</span>
      <code class="tdb-url">{{ dbUrl }}</code>
    </div>

    <!-- Tabs -->
    <div class="tdb-tabs">
      <button v-for="t in (['entities','query','stats'] as const)" :key="t"
        class="tdb-tab" :class="{ active: activeTab === t }" @click="switchTab(t)">{{ t }}</button>
    </div>

    <!-- ── Entities ───────────────────────────────────────────────────────── -->
    <div v-if="activeTab === 'entities'" class="tdb-body">
      <div class="tdb-pills">
        <button class="tdb-pill" :class="{ active: !selectedType }" @click="selectedType = null">
          All · {{ entities.length }}
        </button>
        <button v-for="t in entityTypes" :key="t" class="tdb-pill" :class="{ active: selectedType === t }"
          @click="selectedType = t">{{ t }}</button>
        <button class="tdb-pill tdb-pill-icon" @click="fetchEntities" title="Refresh">↻</button>
      </div>
      <div v-if="loadingEntities" class="tdb-muted">Loading…</div>
      <div v-else-if="!filteredEntities.length" class="tdb-muted">No entities found.</div>
      <div v-else class="tdb-list">
        <div v-for="e in filteredEntities" :key="e.id" class="tdb-entity">
          <div class="tdb-entity-row" @click="toggleExpand(e.id)">
            <span class="tdb-arrow">{{ expandedIds.has(e.id) ? '▾' : '▸' }}</span>
            <span class="tdb-etype">{{ e.type }}</span>
            <span class="tdb-eid">{{ e.id }}</span>
          </div>
          <div v-if="expandedIds.has(e.id)" class="tdb-attrs">
            <div v-for="[key, val] in entityAttrs(e)" :key="String(key)" class="tdb-attr">
              <span class="tdb-akey">{{ key }}</span>
              <span class="tdb-aval">{{ typeof val === 'object' ? JSON.stringify(val) : val }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Query ─────────────────────────────────────────────────────────── -->
    <div v-else-if="activeTab === 'query'" class="tdb-body">
      <textarea class="tdb-textarea" v-model="queryText"
        placeholder='find Note where pinned = "true"'
        @keydown.meta.enter.prevent="runQuery"
        @keydown.ctrl.enter.prevent="runQuery"
        spellcheck="false" />
      <div class="tdb-examples">
        <span v-for="q in EXAMPLES" :key="q" class="tdb-ex" @click="queryText = q">{{ q }}</span>
      </div>
      <button class="tdb-run" :disabled="queryLoading || !queryText.trim()" @click="runQuery">
        {{ queryLoading ? 'Running…' : 'Run  ⌘↵' }}
      </button>
      <div v-if="queryError" class="tdb-error">{{ queryError }}</div>
      <pre v-else-if="queryResult" class="tdb-result">{{ JSON.stringify(queryResult, null, 2) }}</pre>
    </div>

    <!-- ── Stats ─────────────────────────────────────────────────────────── -->
    <div v-else-if="activeTab === 'stats'" class="tdb-body">
      <div v-if="health" class="tdb-block">
        <div class="tdb-row">
          <span class="tdb-label">Status</span>
          <span class="tdb-badge ok">{{ health.status }}</span>
        </div>
        <div v-if="health.uptime !== undefined" class="tdb-row">
          <span class="tdb-label">Uptime</span>
          <span>{{ Math.round(health.uptime) }}s</span>
        </div>
      </div>
      <div v-if="Object.keys(entityCounts).length" class="tdb-block">
        <div class="tdb-section-label">Entity Types</div>
        <div v-for="(count, type) in entityCounts" :key="String(type)" class="tdb-row">
          <span class="tdb-label">{{ type }}</span>
          <span class="tdb-count">{{ count }}</span>
        </div>
        <div class="tdb-row tdb-row-total">
          <span class="tdb-label">Total</span>
          <span class="tdb-count">{{ totalEntities }}</span>
        </div>
      </div>
      <div class="tdb-block">
        <div class="tdb-section-label">REST API</div>
        <div v-for="ep in ENDPOINTS" :key="ep.m + ep.p" class="tdb-ep">
          <span class="tdb-method" :class="ep.m.toLowerCase()">{{ ep.m }}</span>
          <code class="tdb-path">{{ ep.p }}</code>
        </div>
      </div>
    </div>

  </div>
</template>

<style>
:host {
  all: initial;
  font-family: ui-monospace, 'Cascadia Code', 'SF Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  color-scheme: dark;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ── Toggle pill ─────────────────────────────────────────────────────────── */
.tdb-toggle {
  position: fixed; z-index: 2147483647;
  display: flex; align-items: center; gap: 5px;
  padding: 7px 13px;
  background: #0f0f1a; border: 1px solid #4c1d95; border-radius: 999px;
  color: #a78bfa; cursor: pointer; user-select: none;
  font-size: 11px; font-weight: 600; letter-spacing: 0.4px;
  box-shadow: 0 2px 16px rgba(109,40,217,.35);
  transition: border-color .15s, box-shadow .15s;
}
.tdb-toggle:hover { border-color: #a78bfa; box-shadow: 0 2px 20px rgba(109,40,217,.55); }

/* ── Panel ───────────────────────────────────────────────────────────────── */
.tdb-panel {
  position: fixed; z-index: 2147483647;
  width: 360px; max-height: 520px;
  background: #0a0a14; border: 1px solid #1e1b4b; border-radius: 10px;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 12px 48px rgba(0,0,0,.7), 0 0 0 1px rgba(124,58,237,.15);
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 12px; color: #e2e8f0;
}

/* ── Header ──────────────────────────────────────────────────────────────── */
.tdb-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px; background: #0f0f1e;
  border-bottom: 1px solid #1e1b4b;
  cursor: grab; user-select: none; flex-shrink: 0;
}
.tdb-header:active { cursor: grabbing; }
.tdb-header-l, .tdb-header-r { display: flex; align-items: center; gap: 7px; }
.tdb-title { font-weight: 700; font-size: 12px; color: #a78bfa; letter-spacing: .3px; }
.tdb-link {
  font-size: 10px; color: #64748b; cursor: pointer; letter-spacing: .2px;
  text-decoration: none; transition: color .15s;
}
.tdb-link:hover { color: #a78bfa; }
.tdb-close {
  background: none; border: none; color: #4b5563; cursor: pointer;
  font-size: 12px; padding: 2px 5px; border-radius: 3px; line-height: 1;
  font-family: inherit;
}
.tdb-close:hover { color: #e2e8f0; background: #1e1b4b; }

/* ── URL bar ─────────────────────────────────────────────────────────────── */
.tdb-urlbar {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 12px; background: #08080f;
  border-bottom: 1px solid #13132a; flex-shrink: 0;
}
.tdb-dot { font-size: 9px; color: #22c55e; }
.tdb-url { font-size: 10px; color: #475569; font-family: inherit; }

/* ── Tabs ────────────────────────────────────────────────────────────────── */
.tdb-tabs {
  display: flex; background: #08080f;
  border-bottom: 1px solid #1e1b4b; flex-shrink: 0;
}
.tdb-tab {
  flex: 1; padding: 7px 0; background: none; border: none;
  border-bottom: 2px solid transparent; color: #374151;
  cursor: pointer; font-size: 11px; font-family: inherit;
  letter-spacing: .3px; transition: color .15s, border-color .15s;
}
.tdb-tab:hover { color: #94a3b8; }
.tdb-tab.active { color: #a78bfa; border-bottom-color: #7c3aed; }

/* ── Body ────────────────────────────────────────────────────────────────── */
.tdb-body {
  flex: 1; overflow-y: auto; padding: 8px;
  display: flex; flex-direction: column; gap: 6px;
}
.tdb-body::-webkit-scrollbar { width: 3px; }
.tdb-body::-webkit-scrollbar-track { background: transparent; }
.tdb-body::-webkit-scrollbar-thumb { background: #1e1b4b; border-radius: 2px; }
.tdb-muted { color: #374151; text-align: center; padding: 20px 0; font-size: 11px; }

/* ── Pills ───────────────────────────────────────────────────────────────── */
.tdb-pills { display: flex; flex-wrap: wrap; gap: 4px; }
.tdb-pill {
  padding: 2px 8px; background: #0f0f1e; border: 1px solid #1e1b4b;
  border-radius: 999px; color: #374151; cursor: pointer;
  font-size: 10px; font-family: inherit; transition: all .1s;
}
.tdb-pill:hover { color: #94a3b8; border-color: #374151; }
.tdb-pill.active { background: #1e1044; border-color: #6d28d9; color: #a78bfa; }
.tdb-pill-icon { padding: 2px 7px; }

/* ── Entity list ─────────────────────────────────────────────────────────── */
.tdb-list { display: flex; flex-direction: column; gap: 2px; }
.tdb-entity-row {
  display: flex; align-items: center; gap: 6px; padding: 4px 7px;
  background: #0f0f1e; border: 1px solid #13132a; border-radius: 4px;
  cursor: pointer; transition: background .1s;
}
.tdb-entity-row:hover { background: #141428; }
.tdb-arrow { color: #374151; font-size: 10px; width: 10px; flex-shrink: 0; }
.tdb-etype {
  color: #6d28d9; font-weight: 700; font-size: 10px; flex-shrink: 0;
  padding-right: 6px; border-right: 1px solid #1e1b4b; margin-right: 2px;
}
.tdb-eid { color: #334155; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
.tdb-attrs {
  background: #08080f; border: 1px solid #13132a; border-top: none;
  border-radius: 0 0 4px 4px; padding: 5px 8px;
  display: flex; flex-direction: column; gap: 2px; margin-top: -1px;
}
.tdb-attr {
  display: grid; grid-template-columns: minmax(4.5rem, 34%) 1fr;
  gap: 8px; font-size: 10px; align-items: start;
}
.tdb-akey { color: #475569; flex-shrink: 0; word-break: break-word; }
.tdb-aval { color: #94a3b8; overflow-wrap: anywhere; word-break: break-word; }

/* ── Query ───────────────────────────────────────────────────────────────── */
.tdb-textarea {
  width: 100%; min-height: 60px; resize: vertical;
  background: #08080f; border: 1px solid #1e1b4b; border-radius: 6px;
  color: #e2e8f0; font-family: inherit; font-size: 11px; padding: 8px; outline: none;
}
.tdb-textarea:focus { border-color: #6d28d9; }
.tdb-examples { display: flex; flex-wrap: wrap; gap: 4px; }
.tdb-ex {
  padding: 2px 6px; background: #0f0f1e; border: 1px solid #1e1b4b;
  border-radius: 4px; color: #374151; cursor: pointer; font-size: 10px; transition: all .1s;
}
.tdb-ex:hover { color: #94a3b8; border-color: #374151; }
.tdb-run {
  padding: 5px 12px; background: #6d28d9; border: none; border-radius: 6px;
  color: #fff; cursor: pointer; font-family: inherit; font-size: 11px;
  font-weight: 600; transition: background .15s; align-self: flex-start;
}
.tdb-run:hover:not(:disabled) { background: #5b21b6; }
.tdb-run:disabled { opacity: .4; cursor: not-allowed; }
.tdb-error {
  background: #180a0a; border: 1px solid #7f1d1d; border-radius: 4px;
  color: #f87171; padding: 6px 8px; font-size: 10px;
}
.tdb-result {
  background: #08080f; border: 1px solid #1e1b4b; border-radius: 4px;
  color: #94a3b8; padding: 8px; font-size: 10px;
  overflow: auto; max-height: 180px; margin: 0; white-space: pre-wrap;
}

/* ── Stats ───────────────────────────────────────────────────────────────── */
.tdb-block {
  background: #0f0f1e; border: 1px solid #13132a; border-radius: 6px;
  padding: 8px; display: flex; flex-direction: column; gap: 4px;
}
.tdb-section-label {
  color: #374151; font-size: 10px; letter-spacing: .5px;
  text-transform: uppercase; margin-bottom: 2px;
}
.tdb-row { display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
.tdb-row-total { border-top: 1px solid #1e1b4b; margin-top: 2px; padding-top: 4px; }
.tdb-label { color: #94a3b8; }
.tdb-badge {
  padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 600;
}
.tdb-badge.ok { background: #052e16; color: #4ade80; }
.tdb-count {
  background: #1e1044; color: #a78bfa; padding: 1px 7px;
  border-radius: 999px; font-size: 10px; font-weight: 600;
}

/* ── Endpoints ───────────────────────────────────────────────────────────── */
.tdb-ep { display: flex; align-items: center; gap: 8px; font-size: 10px; padding: 2px 0; }
.tdb-method {
  font-weight: 700; font-size: 9px; width: 38px; text-align: center;
  padding: 1px 4px; border-radius: 3px; flex-shrink: 0;
}
.tdb-method.get    { background: #172554; color: #60a5fa; }
.tdb-method.post   { background: #052e16; color: #4ade80; }
.tdb-method.put    { background: #2d1900; color: #fbbf24; }
.tdb-method.delete { background: #280a0a; color: #f87171; }
.tdb-path { color: #475569; font-family: inherit; }
</style>
