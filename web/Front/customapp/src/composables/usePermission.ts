import { computed, type ComputedRef } from 'vue'
import { useAuthStore } from '@/stores/authStore'

/**
 * Reactive permission helper.
 *
 * @example
 *   const canEditProject = usePermission('project.edit', projectId)
 *   <button v-if="canEditProject.value">Edit</button>
 *
 *   // Imperative check inside an action:
 *   const { can } = usePermissions()
 *   if (!can('wp.delete', projectId)) throw new Error('forbidden')
 */
export function usePermission(
  permissionKey: string,
  projectId?: string | null,
): ComputedRef<boolean> {
  const auth = useAuthStore()
  return computed(() => auth.can(permissionKey, projectId ?? null))
}

/** Non-reactive access to the underlying checker. */
export function usePermissions(): {
  can: (permissionKey: string, projectId?: string | null) => boolean
} {
  const auth = useAuthStore()
  return { can: auth.can }
}
