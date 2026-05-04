export interface AiActionItemInput {
  description: string
  assigneeName?: string
  dueDate?: string
}

export interface AiDecisionInput {
  description: string
  category: 'decision' | 'risk'
}

export interface AiAnalysisResult {
  summary: string
  actionItems: AiActionItemInput[]
  decisions: AiDecisionInput[]
}
