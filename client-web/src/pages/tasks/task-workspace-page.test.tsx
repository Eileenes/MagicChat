import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ProjectTask } from "@/components/projects/project-types"
import { TaskWorkspacePage } from "@/pages/tasks/task-workspace-page"

const mocks = vi.hoisted(() => ({
  getClientProject: vi.fn(),
  getClientProjectTask: vi.fn(),
  listClientProjects: vi.fn(),
  listClientProjectTasks: vi.fn(),
}))

vi.mock("@/lib/project-data-api", () => ({
  getClientProject: mocks.getClientProject,
  listClientProjects: mocks.listClientProjects,
}))

vi.mock("@/lib/project-task-data-api", () => ({
  getClientProjectTask: mocks.getClientProjectTask,
  listClientProjectTasks: mocks.listClientProjectTasks,
}))

vi.mock("@/components/projects/project-task-details-dialog", () => ({
  ProjectTaskDetailsDialog: ({ task }: { task: ProjectTask }) => (
    <section aria-label="任务详情">详情：{task.title}</section>
  ),
}))

vi.mock("@/components/projects/create-project-task-dialog", () => ({
  CreateProjectTaskDialog: () => null,
}))

describe("TaskWorkspacePage", () => {
  beforeEach(() => {
    mocks.getClientProject.mockReset()
    mocks.getClientProject.mockResolvedValue(
      createProject("project-1", "发布项目")
    )
    mocks.getClientProjectTask.mockReset()
    mocks.listClientProjects.mockReset()
    mocks.listClientProjects.mockResolvedValue({
      nextCursor: null,
      personalProject: createProject("personal-project", "个人工作区", true),
      projects: [createProject("project-1", "发布项目")],
    })
    mocks.listClientProjectTasks.mockReset()
    mocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [createTask()],
    })
  })

  it("keeps the task list visible and opens details through the route", async () => {
    const user = userEvent.setup()
    renderWorkspace("/tasks/project-1")

    expect(await screen.findByText("发布任务")).toBeInTheDocument()
    expect(
      screen.getByRole("combobox", { name: "切换项目" })
    ).toHaveTextContent("发布项目")

    await user.click(screen.getByRole("button", { name: /发布任务/ }))

    expect(await screen.findByLabelText("任务详情")).toHaveTextContent(
      "详情：发布任务"
    )
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/tasks/project-1/task-1"
    )
  })

  it("loads a deep-linked task that is not in the first list page", async () => {
    mocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [],
    })
    mocks.getClientProjectTask.mockResolvedValue(createTask())

    renderWorkspace("/tasks/project-1/task-1")

    expect(await screen.findByLabelText("任务详情")).toHaveTextContent(
      "详情：发布任务"
    )
    await waitFor(() => {
      expect(mocks.getClientProjectTask).toHaveBeenCalledWith(
        "project-1",
        "task-1"
      )
    })
  })
})

function renderWorkspace(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/tasks/:projectId/:taskId?"
          element={
            <>
              <TaskWorkspacePage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function createProject(id: string, name: string, isPersonal = false) {
  return {
    avatar: "",
    description: "",
    id,
    isPersonal,
    name,
    updatedAt: "2026-07-14T08:00:00Z",
  }
}

function createTask(): ProjectTask {
  return {
    assignee: null,
    canceledAt: null,
    completedAt: null,
    createdAt: "2026-07-14T08:00:00Z",
    creator: { avatar: "", id: "user-1", name: "Alice", nickname: "" },
    description: "",
    dueDate: null,
    id: "task-1",
    labels: [],
    priority: 2,
    projectId: "project-1",
    reminder: null,
    startDate: null,
    status: "todo",
    title: "发布任务",
    updatedAt: "2026-07-14T08:00:00Z",
  }
}
