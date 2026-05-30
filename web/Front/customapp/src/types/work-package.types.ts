/** @file src/types/work-package.types.ts — Work package domain types */

export type WpType = 'Task' | 'Bug' | 'Feature' | 'Milestone' | 'Epic' | 'Incident'
export type WpStatus = 'New' | 'InProgress' | 'AwaitingReview' | 'Resolved' | 'Closed' | 'OnHold' | 'Rejected'
export type WpPriority = 'Low' | 'Normal' | 'High' | 'Urgent' | 'Immediate'

export interface UserSummary {
  id: string
  firstName: string
  lastName: string
  email?: string
  avatarPath?: string | null
}

export interface WorkPackage {
  id: string
  projectId: string
  title: string
  description?: string | null
  type: WpType
  status: WpStatus
  priority: WpPriority
  assigneeId?: string | null
  authorId: string
  parentId?: string | null
  sprintId?: string | null
  versionId?: string | null
  boardColumnId?: string | null
  startDate?: string | null
  dueDate?: string | null
  estimatedHours?: number | null
  spentHours: number
  percentDone: number
  position: number
  isDeleted: boolean
  createdAt: string
  updatedAt: string
  assignee?: UserSummary | null
  author?: UserSummary
  // Populated by the detail endpoint (findOne) so the UI can gate PM-only actions
  // (validate / reject a submitted task) to THIS project's manager.
  project?: { id: string; name?: string | null; projectManagerId?: string | null }
  parent?: { id: string; title: string } | null
  children?: WorkPackage[]
  watchers?: { userId: string; user: UserSummary }[]
  dependenciesOut?: { id: string; toWpId: string; type: string; toWp?: { id: string; title: string; status: string } }[]
  dependenciesIn?: { id: string; fromWpId: string; type: string; fromWp?: { id: string; title: string; status: string } }[]
  customValues?: { customFieldId: string; value: string | null; customField?: { id: string; name: string; fieldType: string } }[]
  _count?: { children: number; watchers: number }
}

export interface CreateWpPayload {
  title: string
  description?: string
  type?: WpType
  status?: WpStatus
  priority?: WpPriority
  assigneeId?: string
  parentId?: string
  sprintId?: string
  versionId?: string
  startDate?: string
  dueDate?: string
  estimatedHours?: number
}

export interface UpdateWpPayload {
  title?: string
  description?: string | null
  type?: WpType
  status?: WpStatus
  priority?: WpPriority
  assigneeId?: string | null
  parentId?: string | null
  sprintId?: string | null
  versionId?: string | null
  boardColumnId?: string | null
  startDate?: string | null
  dueDate?: string | null
  estimatedHours?: number | null
  spentHours?: number
  percentDone?: number
  position?: number
}

export interface WorkPackageCustomField {
  id: string
  projectId: string
  name: string
  fieldType: string
  options?: string | null
  isRequired: boolean
  position: number
}
