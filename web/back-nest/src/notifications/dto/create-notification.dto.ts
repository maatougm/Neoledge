export interface CreateNotificationDto {
  type: string;
  title: string;
  message: string;
  projectId?: string;
}
