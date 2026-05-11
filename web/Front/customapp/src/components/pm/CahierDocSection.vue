<!-- @file src/components/pm/CahierDocSection.vue
     Renders one section of a saved cahier des charges (title + lightweight markdown). -->
<template>
  <section :class="['cahier-doc-section', `cahier-doc-section--${level}`]">
    <component :is="headingTag" class="cahier-doc-section__title">{{ title }}</component>
    <div class="cahier-doc-section__body" v-html="renderedHtml" />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { sanitize } from '@/lib/sanitize'

const props = withDefaults(
  defineProps<{
    title: string
    markdown: string | null | undefined
    level?: 'main' | 'sub'
  }>(),
  { level: 'main' },
)

const headingTag = computed(() => (props.level === 'sub' ? 'h4' : 'h3'))

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const renderedHtml = computed(() => {
  const raw = (props.markdown ?? '').trim()
  if (!raw) return '<p class="cahier-doc-section__empty">À définir</p>'

  const escaped = escapeHtml(raw)

  // Inline bold — must run after escaping so `**` is unaffected by HTML escapes
  let withBold = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

  // Split into paragraphs separated by blank lines
  const blocks = withBold.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)

  const html = blocks
    .map((block) => {
      const lines = block.split(/\n/).map((l) => l.trim())
      const allBullets = lines.every((l) => /^[-*]\s+/.test(l))
      if (allBullets) {
        return `<ul>${lines.map((l) => `<li>${l.replace(/^[-*]\s+/, '')}</li>`).join('')}</ul>`
      }
      // Mixed lines → keep inline newlines as <br>
      return `<p>${lines.join('<br>')}</p>`
    })
    .join('')

  // Defence-in-depth: even though we already HTML-escape the raw input
  // before applying inline-bold markdown, run the result through the
  // shared DOMPurify pipeline. AI output through this path is otherwise
  // the one v-html consumer that bypasses sanitize().
  return sanitize(html)
})
</script>

<style scoped>
.cahier-doc-section { margin: 0 0 18px; }
.cahier-doc-section--sub { margin-left: 12px; padding-left: 12px; border-left: 2px solid var(--nl-border, #e0e0e0); }

.cahier-doc-section__title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0 0 6px;
  color: var(--nl-text-1, #111);
}
.cahier-doc-section--sub .cahier-doc-section__title {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--nl-text-2, #333);
}

.cahier-doc-section__body {
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--nl-text-2, #333);
}

.cahier-doc-section__body :deep(p)  { margin: 0 0 8px; }
.cahier-doc-section__body :deep(ul) { margin: 0 0 8px 1.1rem; padding: 0; }
.cahier-doc-section__body :deep(li) { margin: 0 0 3px; }

.cahier-doc-section__body :deep(.cahier-doc-section__empty) {
  font-style: italic;
  color: var(--nl-text-muted, #888);
}
</style>
