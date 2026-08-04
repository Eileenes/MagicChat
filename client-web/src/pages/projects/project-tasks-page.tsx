import { ProjectTasksTab } from "@/components/projects/project-tasks-tab"
import { useProjectDetail } from "@/pages/projects/project-detail-context"

export function ProjectTasksPage() {
  const { onProjectUpdated, project } = useProjectDetail()
  return (
    <ProjectTasksTab
      key={project.id}
      onTasksChanged={onProjectUpdated}
      projectId={project.id}
    />
  )
}
