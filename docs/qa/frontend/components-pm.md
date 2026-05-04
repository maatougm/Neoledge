# PM Components — Line-by-line QA

Files opened:
- `web/Front/customapp/src/components/pm/PhasesStepper.vue`
- `web/Front/customapp/src/components/pm/AIOutputSection.vue`
- `web/Front/customapp/src/components/pm/TeamValidationSection.vue`
- `web/Front/customapp/src/components/pm/CommentsSection.vue`
- `web/Front/customapp/src/components/pm/CommentItem.vue`
- `web/Front/customapp/src/components/pm/ActivityFeed.vue`
- `web/Front/customapp/src/components/pm/TemplatesSection.vue`
- `web/Front/customapp/src/components/pm/ValidationTimeline.vue`
- `web/Front/customapp/src/components/pm/PMProjectList.vue`
- `web/Front/customapp/src/components/pm/MeetingRecorder.vue`
- `web/Front/customapp/src/components/pm/TranscriptViewer.vue`
- `web/Front/customapp/src/components/pm/MeetingAiPanel.vue`
- `web/Front/customapp/src/components/pm/QuestionnaireForm.vue`
- `web/Front/customapp/src/components/pm/MeetingSection.vue`
- `web/Front/customapp/src/components/pm/AutomationSection.vue`
- `web/Front/customapp/src/components/pm/PMProjectDetail.vue`

Also cross-referenced (read-only):
- `web/Front/customapp/src/stores/pmStore.ts` (lines 30–371) — AI polling lifecycle
- `web/Front/customapp/src/composables/useCollaborationSocket.ts` — presence/remoteField

---

## Executive summary

The pre-flagged `v-html` in `MeetingAiPanel.vue:85` is **NOT an XSS vector** (see HIGH → downgraded finding below) because `renderSummary` escapes `&`/`<`/`>` before wrapping lines in heading / list / paragraph tags. No user-controlled attribute or tag survives. That said, the pattern is fragile (one future edit to skip escaping = trivial XSS) and should be hardened.

More material issues found:
- **CRITICAL stale-write race** in `QuestionnaireForm` collaborative merge: the incoming remote value is coerced via boolean-string parse, but for a `Date` field (v-model is `string | null`) a `null` incoming change is discarded — combined with the 500 ms outbound debounce and no version/LWW, concurrent editors can overwrite each other.
- **HIGH** — `QuestionnaireForm` triggers `collab.sendFieldUpdate` on **every** keystroke via the `@input` → debounce chain, but the debounce never flushes on `blur` or on component `onUnmounted`, so the last character typed before leaving is silently dropped from the broadcast (local save still works — remote viewers see stale text).
- **HIGH** — `PMProjectDetail` `exportPdf` writes `project.name` directly into `<title>${props.project.name}</title>` via `document.write`. Admin sets the project name server-side, but NestJS `create project` does not HTML-escape the name, so `</title><script>...</script>` in a project name = XSS in the print popup. PM-editable field.
- **HIGH** — `TemplatesSection` still uses legacy `primevue/dialog` and `primevue/checkbox` instead of the custom `AppModal` the v3 UX rework mandates (see `common/AppModal.vue`). `UserFormDialog.vue` was already migrated in commit `d4b5258`; this one was missed.
- **MEDIUM** — `AutomationSection` rule builder ships `actionMessage` / `actionUserId` / `actionFieldId` / `actionValue` to the backend with zero client-side validation. Empty, whitespace-only, and non-UUID user IDs all reach `/automation/rules`.
- **MEDIUM** — `MeetingRecorder` missing `onbeforeunload` / route-guard protection: user navigating away mid-recording loses the audio silently (`onBeforeUnmount` calls `.stop()` but `onstop` tries to set reactive state on an unmounted component).
- **MEDIUM** — `MeetingSection` file upload has no client-side size or MIME check; a 500 MB MP4 is happily FormData-uploaded and will 413 or time out only server-side.
- **MEDIUM** — `CommentsSection` optimistic UX regressions: submit failures are caught, but the `newContent` is NOT restored, so user loses their typed content on server error.
- **MEDIUM** — `MeetingAiPanel.onUnmounted` calls `store.stopAiPolling()` globally — if another `MeetingAiPanel` for another meeting is mounted (tab switcher inside tab switcher, or two meetings open in split views), unmounting one kills polling for the other.
- **LOW** — `NeoButton severity="warn"` used in `MeetingAiPanel.vue:192` — per `CLAUDE.md` NeoTag allows `"warning"` not `"warn"`. `[UNCERTAIN]` — this is for `NeoTag`, not `NeoButton`, so may be accepted. `NeoTag`'s documented severities in CLAUDE.md are `"success" | "info" | "warning" | "danger" | "secondary" | "contrast"` — `"warn"` is not in the list.
- Several LOW NeoLibrary-API / a11y misuses below.

---

## Findings

### [HIGH] `v-html` rendered from AI-authored summary — defense-in-depth missing (DOMPurify not installed)

- File: `web/Front/customapp/src/components/pm/MeetingAiPanel.vue:85`
- Category: xss
- Evidence (template):
```vue
<div v-if="results.aiSummary" class="ai-summary-prose" v-html="renderSummary(results.aiSummary)" />
```
- Evidence (`renderSummary` at lines 223–238):
```vue
function renderSummary(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split('\n')
    .map((line) => {
      if (/^## (.+)/.test(line)) return `<h2 class="prose-h2">${line.replace(/^## /, '')}</h2>`
      if (/^# (.+)/.test(line))  return `<h1 class="prose-h1">${line.replace(/^# /, '')}</h1>`
      if (/^- (.+)/.test(line))  return `<li class="prose-li">${line.replace(/^- /, '')}</li>`
      if (/^\* (.+)/.test(line)) return `<li class="prose-li">${line.replace(/^\* /, '')}</li>`
      if (line.trim() === '')    return '<br />'
      return `<p class="prose-p">${line}</p>`
    })
    .join('')
}
```
- Impact: The current implementation is **safe as written** — all user-controlled angle brackets and ampersands are entity-escaped before any tag wrapping, and the only HTML the function introduces (`<h1>`, `<h2>`, `<li>`, `<p>`, `<br />`, all with fixed attributes) is static. A single future edit that moves the escape step, or adds e.g. link/bold support by regex, is a trivial XSS. A project-wide search confirms **DOMPurify is not imported anywhere** in the repo (`DOMPurify|dompurify|sanitize` returns zero hits outside the two `v-html` sites). No defense-in-depth layer exists.
- Fix: install `isomorphic-dompurify`, wrap the return in `DOMPurify.sanitize(html, { ALLOWED_TAGS: ['h1','h2','p','li','br'], ALLOWED_ATTR: ['class'] })`. Add a regression test that asserts `<script>`, `<img onerror=…>`, and `<a href=javascript:…>` are stripped.

### [HIGH] Collaborative stale-overwrite race in `QuestionnaireForm`

- File: `web/Front/customapp/src/components/pm/QuestionnaireForm.vue:216,245-256`
- Category: race
- Evidence:
```vue
const debouncedSendUpdate = debounce((fieldId: string, value: string) => {
  collab.sendFieldUpdate(props.project.id, fieldId, value)
}, 500)
...
watch(
  () => collab.remoteFieldChange.value,
  (change) => {
    if (!change) return
    if (change.updatedBy === auth.userId) return
    const parsed: string | boolean =
      change.value === 'true' ? true : change.value === 'false' ? false : change.value
    values[change.projectFieldId] = parsed
  },
)
```
- Impact:
  1. User A types "foo" → debounce scheduled to send in 500 ms.
  2. Within 500 ms, user B's change arrives → local `values[fieldId]` replaced with B's value.
  3. User A's pending debounce fires → sends A's stale "foo" snapshot (which may or may not have been overwritten on screen by B) → B's change is clobbered server-side. No version vector / updatedAt-check exists.
  4. Additionally, the remote-apply watcher uses plain assignment on a `reactive` object, which triggers the `@input` handler of `NeoInputText` for `Text`/`Number` fields, potentially re-scheduling *another* `sendFieldUpdate` in an infinite ping-pong. `[UNCERTAIN]` — depends on whether `NeoInputText` fires `@input` for programmatic `v-model` changes; most PrimeVue-based inputs do.
- Fix: (a) stamp each outbound field-update with a client-generated `version` (monotonic counter per field), drop incoming changes with `version < local.version`. (b) In the watcher, guard against firing local `@input` by setting a per-field `suppressNextInput` flag. (c) Flush the debounce on `blur` (see next finding).

### [HIGH] `QuestionnaireForm` debounce is never flushed on blur / unmount — last keystroke dropped

- File: `web/Front/customapp/src/components/pm/QuestionnaireForm.vue:57-58,208-218,239-241`
- Category: race
- Evidence:
```vue
@input="() => { dirty = true; debouncedSendUpdate(field.id, String(values[field.id] ?? '')) }"
@blur="() => { validateField(field.id, field.isRequired); collab.sendFieldBlur(props.project.id) }"
...
function debounce<T extends (...args: never[]) => unknown>(fn: T, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}
...
onUnmounted(() => {
  collab.leaveProject(props.project.id)
})
```
- Impact: Blur fires only `sendFieldBlur` (presence) — the pending debounced `sendFieldUpdate` is **not** flushed. If the user types a char and blurs within 500 ms, remote peers never see that character. Same on tab switch (unmount): `collab.leaveProject` runs but the debounce `setTimeout` is canceled implicitly only if the component is GC'd — the closure still fires, harmlessly (socket already left). The local save button works because it reads `values` directly, so the user sees their data saved, but **other collaborators are desynced until next keystroke**.
- Fix: return a `{ call, flush, cancel }` tuple from `debounce`; call `flush` inside `@blur` and inside `onUnmounted`.

### [HIGH] `PMProjectDetail.exportPdf` — HTML injection via `project.name` into `document.write` popup

- File: `web/Front/customapp/src/components/pm/PMProjectDetail.vue:157-185`
- Category: xss
- Evidence:
```vue
function exportPdf(): void {
  const printArea = document.getElementById('pm-print-area')
  if (!printArea) return
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${props.project.name}</title>
      ...
    <body>
      ${printArea.innerHTML}
    </body>
    </html>
  `)
```
- Impact: `project.name` is interpolated with a template literal directly into raw HTML. A project name of `</title><script>alert(document.cookie)</script><title>x` in the admin form would execute JS in the newly opened `about:blank` popup (same-origin-ish via `window.opener`). Admin alone can create projects today, but there is no sanitiser and the model is "trust-once" — a compromised admin or a future PM-can-edit-name feature becomes instant XSS. `printArea.innerHTML` is already DOM-escaped by Vue's `{{ }}` renderer before `document.getElementById` reads it, so the body is safe; only the title string is vulnerable.
- Fix: either (a) `win.document.title = props.project.name` **after** `document.write` with a static title, or (b) use a DOMParser and `textContent` assignment, or (c) pipe through a `escapeHtml()` util.

### [HIGH] `TemplatesSection` uses legacy `primevue/dialog` + `primevue/checkbox` — v3 UX rework missed this file

- File: `web/Front/customapp/src/components/pm/TemplatesSection.vue:4,30,120,121`
- Category: neolibrary
- Evidence:
```vue
<Dialog v-model:visible="showCreateDialog" header="Nouveau modèle" :modal="true" style="width: 600px">
...
<Checkbox v-model="f.isRequired" :binary="true" />
...
import Dialog from 'primevue/dialog'
...
import Checkbox from 'primevue/checkbox'
```
- Impact: per `CLAUDE.md` → "Known Issues & Constraints" and commit `d4b5258` ("replace primevue Dialog with custom modal in UserFormDialog"), `NeoDialog` is deprecated and the project standardized on `components/common/AppModal.vue`. This file was left on the old pattern, causing visual / z-index / scrim inconsistencies with the rest of the app. `AutomationSection.vue:81` has the same issue (see MEDIUM below).
- Fix: port to `AppModal` following the pattern already applied in `UserFormDialog.vue`.

### [MEDIUM] `AutomationSection` rule builder — no input validation on `actionConfig` payload

- File: `web/Front/customapp/src/components/pm/AutomationSection.vue:236-267`
- Category: validation
- Evidence:
```vue
async function submitRule() {
  formError.value = null
  if (!form.value.name.trim()) { formError.value = 'Le nom de la règle est requis.'; return }
  if (!form.value.triggerEvent) { formError.value = "L'événement déclencheur est requis."; return }
  if (!form.value.actionType)  { formError.value = "Le type d'action est requis."; return }

  const actionConfig: Record<string, unknown> = {}
  if (form.value.actionType === 'send_notification') {
    actionConfig['message'] = form.value.actionMessage
    actionConfig['userId']  = form.value.actionUserId
  } else if (form.value.actionType === 'update_field') {
    actionConfig['fieldId'] = form.value.actionFieldId
    actionConfig['value']   = form.value.actionValue
  }
  saving.value = true
  const ok = await store.createAutomationRule(props.projectId, { ... actionConfig ... })
```
- Impact: `actionMessage` empty → notification body is empty string; `actionUserId` is a free-text input with no UUID regex — typo-ing an ID creates a rule that silently fails every execution. `actionFieldId` / `actionValue` unchecked — an update_field rule pointing at a deleted field will fail forever. No trim, no length cap (XSS-adjacent: `message` will later flow into `Notification` rows shown in the bell dropdown; safe since the notification store uses `{{ }}` interpolation, but un-sanitized messages could include misleading unicode or 10 KB of text). Additionally `logStatusSeverity` (line 216) is defined but never used in the template — dead code.
- Fix: require non-empty `message`, validate `userId` via zod `z.string().uuid()`, populate a `NeoSelect` with actual project users/fields instead of free-text inputs. Remove `logStatusSeverity`.

### [MEDIUM] `AutomationSection` — same legacy `primevue/dialog` issue as Templates

- File: `web/Front/customapp/src/components/pm/AutomationSection.vue:81,153`
- Category: neolibrary
- Evidence:
```vue
<Dialog v-model:visible="dialogVisible" header="Nouvelle règle d'automatisation" modal :style="{ width: '480px' }">
...
import Dialog from 'primevue/dialog'
```
- Impact: inconsistent with the v3 UX-rework migration. See HIGH above.
- Fix: port to `AppModal`.

### [MEDIUM] `MeetingSection` — no client-side MIME/size validation on file upload

- File: `web/Front/customapp/src/components/pm/MeetingSection.vue:23-29,198-216,218-238`
- Category: validation
- Evidence:
```vue
<input
  ref="fileInput"
  type="file"
  accept="audio/*,.mp3,.wav,.webm,.ogg,.m4a,.mp4,.flac"
  style="display:none"
  @change="onFileSelected"
/>
...
function onFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0] ?? null
  if (file) {
    uploadFile.value = file
    uploadTitle.value = file.name.replace(/\.[^.]+$/, '')
    view.value = 'upload'
  }
...
function onDrop(e: DragEvent) {
  isDragOver.value = false
  const file = e.dataTransfer?.files?.[0] ?? null
  if (file) {
    uploadFile.value = file
    uploadTitle.value = file.name.replace(/\.[^.]+$/, '')
  }
}
```
- Impact: `accept=` is an advisory UX hint, not a security control — drag-and-drop (`onDrop`) **completely bypasses** the `accept=` filter. A user can drop a 2 GB `.iso` file and the app will try to FormData-upload it to the FastAPI transcription service. No size check, no MIME check, no magic-byte check. Also `file.name` is interpolated into `uploadTitle` without any length cap.
- Fix: inside `onFileSelected` and `onDrop`, check `file.type.startsWith('audio/') || /\.(mp3|wav|webm|ogg|m4a|mp4|flac)$/i.test(file.name)`, check `file.size < 500 * 1024 * 1024`, show a `NeoToast` on rejection, and clamp the derived title to 120 chars.

### [MEDIUM] `MeetingRecorder` — component unmounts mid-recording lose audio silently

- File: `web/Front/customapp/src/components/pm/MeetingRecorder.vue:121-126,206-212`
- Category: race
- Evidence:
```vue
mediaRecorder.onstop = () => {
  const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
  recordedBlob.value = blob
  audioUrl.value = URL.createObjectURL(blob)
  stream.getTracks().forEach((t) => t.stop())
}
...
onBeforeUnmount(() => {
  if (timerInterval) clearInterval(timerInterval)
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
})
```
- Impact: Calling `mediaRecorder.stop()` in `onBeforeUnmount` fires `onstop` async, which tries to mutate `recordedBlob.value` / `audioUrl.value` on an already-disposed reactive scope — Vue silently drops the update, so 10 minutes of recording are lost when the user accidentally navigates away. No `beforeunload` listener prompts the user. No `sessionStorage` persistence. Also `switchSpeaker` (lines 161-170) is defined but **never called** in the template — dead code left from an earlier speaker-switching UI.
- Fix: add `window.addEventListener('beforeunload', handler)` while `isRecording`; optionally stream chunks into `IndexedDB` so a refresh can recover. Remove `switchSpeaker`, `currentSpeaker`, `speakerStart`, `speakerRanges` (they are no longer wired to UI).

### [MEDIUM] `CommentsSection` — submit error wipes nothing but user sees empty box anyway

- File: `web/Front/customapp/src/components/pm/CommentsSection.vue:159-172`
- Category: UX
- Evidence:
```vue
async function submitComment(): Promise<void> {
  const content = newContent.value.trim()
  if (!content) return
  submitting.value = true
  try {
    await store.addComment(props.projectId, content)
    newContent.value = ''
    toast.add({ severity: 'success', detail: 'Commentaire ajouté.', life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: "Impossible d'envoyer le commentaire.", life: 4000 })
  } finally {
    submitting.value = false
  }
}
```
- Impact: on success `newContent.value = ''` runs. On failure the content is preserved — that part is fine. However, if `store.addComment` optimistically inserts + rolls back (unverified), the textarea state stays but the user may re-click and double-submit. Also `@keydown.ctrl.enter.prevent="submitComment"` (line 12) is great, but there is no guard against submitting while `submitting === true`: the handler re-checks `!content.trim()` but not `submitting.value`, enabling rapid-fire duplicate posts via Ctrl+Enter.
- Fix: early-return on `submitting.value` inside `submitComment` and `submitReply`. Disable the textarea while pending to make it visually obvious.

### [MEDIUM] `MeetingAiPanel` — `stopAiPolling` is a shared (global) cancel, breaking multi-panel scenarios

- File: `web/Front/customapp/src/components/pm/MeetingAiPanel.vue:282-297` + `pmStore.ts:31,198-210`
- Category: race
- Evidence (panel):
```vue
onMounted(async () => {
  await store.fetchAiResults(props.projectId, props.meetingId)
  if (results.value && results.value.aiStatus !== 'none') expanded.value = true
  if (results.value?.aiStatus === 'processing') {
    store.resumeAiPolling(props.projectId, props.meetingId)
  }
})

onUnmounted(() => {
  store.stopAiPolling()
})
```
- Evidence (store):
```ts
const aiPolling = ref<ReturnType<typeof setInterval> | null>(null)
...
const stopAiPolling = () => {
  if (aiPolling.value !== null) {
    clearInterval(aiPolling.value)
    aiPolling.value = null
  }
}
```
- Impact: `aiPolling` is a single module-level ref — one `MeetingAiPanel` unmounting kills polling for **every** panel in the app. Also, `aiResults` is a single module-level ref, so viewing meeting A, navigating to meeting B, then switching back shows B's results briefly until `fetchAiResults` resolves. Cross-panel cross-talk waiting to bite.
- Fix: either scope polling per-meeting (map keyed by `meetingId`), or guarantee only one panel can exist at a time. At minimum: in `onUnmounted`, check that the polling target matches `props.meetingId` before stopping.

### [MEDIUM] `ValidationTimeline` — silent empty state on fetch error masks backend failure

- File: `web/Front/customapp/src/components/pm/ValidationTimeline.vue:99-111`
- Category: UX
- Evidence:
```vue
onMounted(async () => {
  loading.value = true
  try {
    const { data } = await api.get<ProjectValidation[]>(
      `/pm/projects/${props.projectId}/validations`,
    )
    validations.value = [...data]
  } catch {
    validations.value = []
  } finally {
    loading.value = false
  }
})
```
- Impact: a 500 from the API is indistinguishable from a real empty list — user sees "Aucune validation enregistrée". No toast, no retry button, no logged error.
- Fix: surface an `errorMessage` ref + `NeoMessage severity="error"` + "Réessayer" button, matching the pattern in `TeamValidationSection.vue:14-29`.

### [MEDIUM] `TeamValidationSection` — form state not fully cleared on successful submit before unmount

- File: `web/Front/customapp/src/components/pm/TeamValidationSection.vue:129-144`
- Category: logic
- Evidence:
```vue
const performSubmit = async (payload: { isApproved: boolean; comment: string | null }): Promise<void> => {
  submitError.value = null
  lastPayload.value = payload

  const ok = await store.submitValidation(props.projectId, payload)
  if (ok) {
    toast.add({ severity: 'success', detail: 'Validation soumise avec succès.', life: 3000 })
    showForm.value = false
    decision.value = null
    comment.value = ''
    lastPayload.value = null
  } else {
    submitError.value = store.error ?? 'Une erreur est survenue lors de la soumission.'
    toast.add({ severity: 'error', detail: submitError.value, life: 5000 })
  }
}
```
- Impact: low — works as designed. Observed that `submitError.value` is cleared at the top, but if `ok === true`, stale `retry-row` stays hidden via `v-if="submitError"`. No issue. Downgrading to `[UNCERTAIN]` note.
- Fix: n/a.

### [LOW] `MeetingAiPanel` — `statusSeverity` returns `'warn'`, NeoTag severity should be `'warning'`

- File: `web/Front/customapp/src/components/pm/MeetingAiPanel.vue:190-197`
- Category: neolibrary
- Evidence:
```vue
const statusSeverity = computed((): 'secondary' | 'warn' | 'success' | 'danger' => {
  switch (results.value?.aiStatus) {
    case 'processing': return 'warn'
    case 'completed': return 'success'
    case 'failed': return 'danger'
    default: return 'secondary'
  }
})
```
- Per `CLAUDE.md` NeoTag severity contract: `"success" | "info" | "warning" | "danger" | "secondary" | "contrast"`. `"warn"` is not listed.
- Impact: `[UNCERTAIN]` — depending on the NeoLibrary implementation, `"warn"` may silently fall through to the default gray styling instead of the warning orange. Same issue appears in `PMProjectDetail.vue:150` (`statusSeverity` cast to `'warn' | ...`) and `PMProjectList.vue:206-207`.
- Fix: rename `'warn'` → `'warning'` in the severity literals; also update `PROJECT_STATUS_SEVERITY` mapping in `types/project.types.ts` if it currently emits `'warn'`.

### [LOW] `AIOutputSection` — `NeoButton severity` omitted correctly; fake-loading `setTimeout` leaks on unmount

- File: `web/Front/customapp/src/components/pm/AIOutputSection.vue:51-63`
- Category: perf
- Evidence:
```vue
const handleGenerate = (): void => {
  generating.value = true
  // Simulate a brief loading state before showing the info toast
  setTimeout(() => {
    generating.value = false
    toast.add({
      severity: 'info',
      detail: 'Fonctionnalité IA bientôt disponible.',
      life: 4000,
    })
  }, 800)
}
```
- Impact: if component unmounts within 800 ms, the callback still fires and writes to `generating.value` on a disposed scope. Also this is dead UX — the button pretends to call an AI that does not exist (the real AI is in `MeetingAiPanel`). The `AIOutputSection` is still wired up in `PMProjectDetail.vue:72` as the "Résultat IA" tab.
- Fix: store `const timer = setTimeout(...)`, clear in `onBeforeUnmount`. Consider deleting this component entirely or wiring it to the real AI service.

### [LOW] `QuestionnaireForm` — `NeoDatePicker` `@focus` / `@blur` listeners not guaranteed to fire

- File: `web/Front/customapp/src/components/pm/QuestionnaireForm.vue:75-88`
- Category: neolibrary
- Evidence:
```vue
<NeoDatePicker
  v-else-if="field.fieldType === 'Date'"
  v-model="(values[field.id] as string | null)"
  dateFormat="yy-mm-dd"
  ...
  @focus="collab.sendFieldFocus(props.project.id, field.id)"
  @blur="collab.sendFieldBlur(props.project.id)"
/>
```
- Impact: `[UNCERTAIN]` — PrimeVue's calendar wrapper does not always forward native `focus`/`blur` on the root; depending on the NeoLibrary implementation, presence indicators for Date fields may never light up.
- Fix: verify with a `console.log` E2E smoke test; if needed, use `@update:modelValue` for presence instead.

### [LOW] `CommentItem` — `@keydown.ctrl.enter.prevent` save fires on stale `editDraft` prop

- File: `web/Front/customapp/src/components/pm/CommentItem.vue:17-22`
- Category: race
- Evidence:
```vue
<textarea
  :value="editDraft"
  class="edit-textarea"
  rows="2"
  @input="$emit('update:editDraft', ($event.target as HTMLTextAreaElement).value)"
  @keydown.escape.prevent="$emit('cancelEdit')"
  @keydown.ctrl.enter.prevent="$emit('saveEdit', editDraft)"
/>
```
- Impact: `editDraft` is a prop, not a ref to the DOM value. When Ctrl+Enter fires, Vue may not have flushed the `@input` → `update:editDraft` → parent update → re-prop-pass cycle yet. The last character typed before Ctrl+Enter can be missing from the saved content. Microtask-dependent.
- Fix: emit `saveEdit` with `($event.target as HTMLTextAreaElement).value` instead of the stale prop.

### [LOW] `CommentItem` / `CommentsSection` — no `@keydown.enter` alone, but no explicit password-field concerns found

- File: (none — password submit is in `LoginView.vue`, out of scope)
- Category: UX
- Evidence: searched PM components; no `type="password"` field present; `@keydown.enter` alone is absent (all use `ctrl.enter`). No accidental submit risk in this scope.
- Impact: no issue.
- Fix: n/a.

### [LOW] `TranscriptViewer` — speaker names rendered via `{{ }}`, safe; mustard gas for CSS but no XSS

- File: `web/Front/customapp/src/components/pm/TranscriptViewer.vue:41-46,80-82,84`
- Category: xss
- Evidence:
```vue
<span class="rename-original">{{ speaker }}</span>
...
<NeoInputText
  :modelValue="speakerNames[speaker] ?? ''"
  @update:modelValue="(v: string) => speakerNames[speaker] = v"
  :placeholder="speaker === 'Speaker 1' ? 'Chef de projet' : speaker === 'Speaker 2' ? 'Client' : speaker"
  class="rename-input"
/>
...
<span class="speaker-name">{{ speakerLabel(seg.speaker) }}</span>
...
<p class="segment-text">{{ seg.text }}</p>
```
- Impact: Vue's `{{ }}` interpolation HTML-escapes. No XSS. Confirmed no `v-html` in this file.
- Fix: n/a. Positive finding.

### [LOW] `TranscriptViewer.applyRenames` — loop aborts on first error, leaving partial state

- File: `web/Front/customapp/src/components/pm/TranscriptViewer.vue:204-222`
- Category: logic
- Evidence:
```vue
async function applyRenames() {
  renaming.value = true
  const renames = Object.entries(speakerNames).filter(([, v]) => v.trim().length > 0)

  for (const [oldName, newName] of renames) {
    try {
      await store.renameSpeaker(props.projectId, props.transcript.id, oldName, newName.trim())
    } catch {
      toast.add({ severity: 'error', detail: `Erreur lors du renommage de "${oldName}".`, life: 3000 })
      renaming.value = false
      return
    }
  }

  toast.add({ severity: 'success', detail: 'Intervenants renommés avec succès.', life: 3000 })
  showRenamePanel.value = false
  renaming.value = false
  emit('renamed')
}
```
- Impact: serial awaits — if rename 3 of 5 fails, the first two are applied, the last two silently skipped. User sees a single error toast, no indication of which renames succeeded. No rollback.
- Fix: `Promise.allSettled`, report summary `"3 renommés, 2 échecs (X, Y)"`.

### [LOW] `AutomationSection` — logs limited to 20 in template with no "load more"

- File: `web/Front/customapp/src/components/pm/AutomationSection.vue:66`
- Category: UX
- Evidence:
```vue
<tr v-for="log in store.automationLogs.slice(0, 20)" :key="log.id">
```
- Impact: older executions are invisible. The backend returns paginated logs per `CLAUDE.md` `/pm/projects/:id/automation/logs`, but UI caps at 20 client-side.
- Fix: add pagination or "Afficher plus" button.

### [LOW] `MeetingSection` — AI badge status check trusts `meeting.aiStatus` that is typed loosely

- File: `web/Front/customapp/src/components/pm/MeetingSection.vue:123-134`
- Category: logic
- Evidence:
```vue
<span v-if="meeting.aiStatus === 'processing'" class="ai-badge ai-badge--processing">
...
<span v-else-if="meeting.aiStatus === 'completed'" class="ai-badge ai-badge--completed">
...
<span v-else-if="meeting.aiStatus === 'failed'" class="ai-badge ai-badge--failed">
```
- Impact: silently hides the badge when `aiStatus === 'none'` (correct) but also hides on any backend-side status drift (e.g. `'queued'`). Not a bug today.
- Fix: add an explicit fallback to keep catching drift in dev.

### [LOW] `PhasesStepper` — clickable area is the whole `.step` div, no keyboard support

- File: `web/Front/customapp/src/components/pm/PhasesStepper.vue:3-9,54-58`
- Category: UX
- Evidence:
```vue
<div
  v-for="(phase, i) in PHASES"
  :key="phase.key"
  :class="['step', stepState(phase.key), { clickable: isAdjacent(phase.key) }]"
  :title="phase.label"
  @click="handleClick(phase.key)"
>
```
- Impact: no `role="button"`, no `tabindex`, no `@keyup.enter`/`@keyup.space` handler. Keyboard/screen-reader users cannot change phase.
- Fix: `:role="isAdjacent(phase.key) ? 'button' : undefined"`, `:tabindex="isAdjacent(phase.key) ? 0 : undefined"`, `@keyup.enter.prevent="handleClick(phase.key)"`.

### [LOW] `PMProjectList` — click handler on whole card with no keyboard equivalent

- File: `web/Front/customapp/src/components/pm/PMProjectList.vue:37-44`
- Category: UX
- Evidence:
```vue
<div
  v-for="p in filtered"
  :key="p.id"
  class="project-card"
  :class="cardUrgencyClass(p)"
  @click="emit('select', p.id)"
>
```
- Impact: same a11y issue as above. Also missing `role="link"` semantics.
- Fix: make the card a `<router-link>` or add `tabindex="0"` + keyboard handler.

### [LOW] `AIOutputSection` — unused `defineProps` return ignored (props declared but generating button ignores them)

- File: `web/Front/customapp/src/components/pm/AIOutputSection.vue:46`
- Category: logic
- Evidence:
```vue
defineProps<{ aiOutput: string | null | undefined }>()
```
- Impact: returned props object is not captured into a `props` const — works because template uses `aiOutput` directly, but violates the codebase convention elsewhere of `const props = defineProps<...>()`.
- Fix: capture to `const props = ...` for consistency.

### [LOW] `TemplatesSection` — dead CSS rules for `.field-list`, `.field-badge`, `.field-name`

- File: `web/Front/customapp/src/components/pm/TemplatesSection.vue:293-310`
- Category: perf
- Evidence:
```vue
.field-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.field-badge { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.35rem 0.7rem; background: var(--nl-surface-2); border: 1px solid var(--nl-border); border-radius: 6px; font-size: 0.82rem; color: var(--nl-text-2); }
.field-name { font-weight: 500; }
```
- Impact: no markup uses these classes (there's a comment at line 101 `<!-- Liste des champs (en lecture seule) - uniquement en mode détail -->` indicating the DOM was removed). Dead styles bloat the payload.
- Fix: delete.

### [UNCERTAIN] `PMProjectDetail.exportPdf` — `win.print()` immediately after `document.write` may race

- File: `web/Front/customapp/src/components/pm/PMProjectDetail.vue:183-184`
- Category: race
- Evidence:
```vue
win.document.close()
win.print()
```
- Impact: Chrome usually executes `print()` synchronously on the new window, but Firefox has been reported to show the print dialog on an empty page if images/fonts are still loading. This page has no images, so likely OK.
- Fix: listen for `win.onload` before calling `print()`.

---

## Summary table

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH     | 4 |
| MEDIUM   | 7 |
| LOW      | 12 |
| UNCERTAIN| 2 |

## Top-3 recommended fixes

1. **`QuestionnaireForm` collaborative race + missing debounce flush** — add per-field version counter and flush debounce on `@blur` / `onUnmounted`. This is the only user-visible data-loss bug in the set.
2. **`PMProjectDetail.exportPdf` HTML injection** — replace template-literal `<title>${name}</title>` with `win.document.title = name` after `write`. One-line fix, kills a real XSS path.
3. **Install DOMPurify and harden `MeetingAiPanel.renderSummary`** — zero regression risk, adds defense-in-depth against future edits of this function. Also apply to `WikiView.vue:40` (out of PM scope but same pattern).
