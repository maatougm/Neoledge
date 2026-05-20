/**
 * @file __test-helpers.ts — shared utilities for vitest view specs.
 *
 * Why this file: every view spec needs the same scaffold (Pinia + Router +
 * NeoLibrary stubs + axios mock). Inlining all of that in 10 specs is
 * noisy; extracting it here keeps each spec focused on the view's actual
 * behaviour.
 *
 * NOT used by component specs that need real NeoLibrary rendering — those
 * should mount with the real library. View specs treat NeoLibrary as a
 * leaf boundary and stub it.
 */

import { vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import type { Component } from 'vue'

// ─── NeoLibrary stubs ────────────────────────────────────────────────────────
// All NeoLibrary components rendered by views in this batch. Each stub
// just passes children through and exposes `value` / `modelValue` props so
// v-model bindings still surface in the rendered output without depending
// on the real library DOM.
export const NEO_STUB_NAMES = [
  'NeoButton', 'NeoInputText', 'NeoPassword', 'NeoMessage', 'NeoSelect',
  'NeoTag', 'NeoDatePicker', 'NeoCheckbox',
] as const

export const neoStubs: Record<string, Component> = Object.fromEntries(
  NEO_STUB_NAMES.map((name) => [
    name,
    {
      name,
      props: ['modelValue', 'value', 'options', 'label', 'placeholder', 'disabled', 'loading', 'severity', 'icon', 'outlined', 'text', 'size', 'title', 'optionLabel', 'optionValue'],
      emits: ['update:modelValue', 'click'],
      template: `<div :data-stub="'${name}'" :data-value="modelValue ?? value ?? ''" :data-label="label ?? ''" :data-disabled="disabled ?? false" :data-loading="loading ?? false" @click="$emit('click', $event)"><slot /></div>`,
    },
  ]),
)

// Stubs for the most-used internal components that views import. Same
// philosophy — treat them as leaf boundaries from the view test's POV.
export const internalStubs: Record<string, Component> = {
  ProjectModuleShell: { template: '<div data-stub="ProjectModuleShell"><slot name="actions" /><slot /></div>' },
  StatCard: { props: ['label', 'value', 'tone', 'icon'], template: '<div data-stub="StatCard" :data-label="label" :data-value="value"></div>' },
  StatusChip: { props: ['status'], template: '<span data-stub="StatusChip">{{ status }}</span>' },
  WpStatusTag: { props: ['status'], template: '<span data-stub="WpStatusTag">{{ status }}</span>' },
  PriorityDot: { props: ['priority'], template: '<span data-stub="PriorityDot">{{ priority }}</span>' },
  AppModal: {
    props: ['visible'],
    emits: ['update:visible'],
    template: '<div v-if="visible" data-stub="AppModal"><slot /><slot name="footer" /></div>',
  },
  TableSkeleton: { template: '<div data-stub="TableSkeleton"></div>' },
  PMProjectList: {
    emits: ['select'],
    template: '<div data-stub="PMProjectList"><button data-test="select-first" @click="$emit(\'select\', \'p1\')">Select</button></div>',
  },
  SprintsPanel: { props: ['projectId'], template: '<div data-stub="SprintsPanel"></div>' },
  EpicCard: {
    props: ['epic', 'epicIdx'],
    template: '<div data-stub="EpicCard">{{ epic?.title }}</div>',
  },
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}

export const ALL_STUBS = { ...neoStubs, ...internalStubs }

// ─── Router helper ───────────────────────────────────────────────────────────
export function makeRouter(initialPath = '/'): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/app', name: 'app-home', component: { template: '<div />' } },
      { path: '/app/pm/projects/:id', name: 'pm-project-detail', component: { template: '<div />' } },
      { path: '/app/pm/projects/:id/:module(.*)', component: { template: '<div />' } },
      { path: '/app/pm/projects/:id/assign-tasks', name: 'pm-assign-tasks', component: { template: '<div />' } },
      { path: '/app/pm/my-tasks', component: { template: '<div />' } },
      { path: '/app/pm/projects', component: { template: '<div />' } },
      { path: '/forgot-password', component: { template: '<div />' } },
    ],
  })
}

// ─── Pinia helper ────────────────────────────────────────────────────────────
export function makePinia(): Pinia {
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

// ─── Axios mock helper ───────────────────────────────────────────────────────
// Each spec calls `mockApiOk(get: { '/path': () => data })` etc. before
// mounting. This keeps the mock close to the test that needs it instead
// of in a far-away beforeEach.

export type ApiMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

export interface ApiMockHandlers {
  get?: Record<string, () => unknown>
  post?: Record<string, () => unknown>
  put?: Record<string, () => unknown>
  patch?: Record<string, () => unknown>
  delete?: Record<string, () => unknown>
}

export function buildApiMock(): { default: Record<ApiMethod, ReturnType<typeof vi.fn>> } & { extractErrorMessage: ReturnType<typeof vi.fn> } {
  return {
    default: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    extractErrorMessage: vi.fn((err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } } | Error | undefined
      if (e && 'response' in e && e.response?.data?.message) return e.response.data.message
      return e instanceof Error ? e.message : null
    }),
  }
}

// ─── Toast / confirm mocks ──────────────────────────────────────────────────
// useNeoToast() / useNeoConfirm() are called inside views' setup. Vitest
// can't intercept those without mocking the module. Each spec that needs
// them calls vi.mock('@neolibrary/components', ...) at the top.
